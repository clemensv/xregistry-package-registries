#!/bin/bash

# Script to configure GHCR backend in oci/config.json using GitHub CLI guidance

CONFIG_FILE="oci/config.json"
JQ_CMD=$(command -v jq)
GH_CMD=$(command -v gh)

# --- Helper Functions ---
echo_blue() {
    printf "\033[0;34m%s\033[0m\n" "$1"
}
echo_green() {
    printf "\033[0;32m%s\033[0m\n" "$1"
}
echo_red() {
    printf "\033[0;31m%s\033[0m\n" "$1"
}
echo_warn() {
    printf "\033[0;33m%s\033[0m\n" "$1"
}

prompt_input() {
    local prompt_text="$1"
    local var_name="$2"
    local is_sensitive="$3"
    local input_val

    if [ "$is_sensitive" == "true" ]; then
        read -rsp "$prompt_text: " input_val
        echo # for newline after sensitive input
    else
        read -rp "$prompt_text: " input_val
    fi
    eval "$var_name=\"$input_val\""
}

# --- Pre-flight Checks ---
if [ -z "$JQ_CMD" ]; then
    echo_red "Error: jq is not installed or not in PATH. Please install jq to continue."
    echo_blue "On macOS: brew install jq"
    echo_blue "On Debian/Ubuntu: sudo apt-get install jq"
    exit 1
fi

if [ -z "$GH_CMD" ]; then
    echo_red "Error: GitHub CLI (gh) is not installed or not in PATH. Please install gh to continue."
    echo_blue "See: https://cli.github.com/"
    exit 1
fi

if [ ! -f "$CONFIG_FILE" ]; then
    echo_red "Error: Configuration file $CONFIG_FILE not found."
    echo_blue "Please ensure you are in the correct directory or create a default config file first."
    # You could offer to create a default one here if desired
    # Example: echo '{ "ociBackends": [] }' | jq . > "$CONFIG_FILE"
    exit 1
fi

# --- Main Logic ---
echo_blue "This script will help you configure the GHCR (GitHub Container Registry) backend in $CONFIG_FILE."

# Check current gh auth status
echo_blue "\nChecking GitHub CLI authentication status..."
if ! gh auth status > /dev/null 2>&1; then
    echo_warn "You are not logged into the GitHub CLI. Attempting to log in..."
    if ! gh auth login -p https -s read:packages -w; then # Login for https, with package read scope, open browser
        echo_red "GitHub CLI login failed. Please log in manually with 'gh auth login' ensuring you grant 'read:packages' scope, then re-run this script."
        exit 1
    fi
    echo_green "Successfully logged into GitHub CLI."
else
    echo_green "GitHub CLI is already authenticated."
fi

GH_USER=""
prompt_input "Enter your GitHub username (the one associated with GHCR)" GH_USER false

if [ -z "$GH_USER" ]; then
    echo_red "GitHub username cannot be empty."
    exit 1
fi

GH_PAT=""
echo ""
echo_blue "You need a Personal Access Token (PAT) with the 'read:packages' scope to access GHCR."
echo_blue "The script can try to help you create one if you don't have a suitable one already."

prompt_input "Do you want to try creating a new PAT now using 'gh auth token create'? (yes/no)" CREATE_PAT_CHOICE false

if [[ "$CREATE_PAT_CHOICE" =~ ^[Yy](ES|es)?$ ]]; then
    echo_blue "\nAttempting to create a new PAT with 'read:packages' scope..."
    echo_blue "Please follow the prompts from the GitHub CLI."
    echo_blue "If prompted for a note, something like 'xregistry-oci-proxy-ghcr' is suitable."
    echo_warn "Important: Copy the generated PAT immediately. It will not be shown again."
    echo_blue "Run the following command in your terminal:"
    echo_blue "  gh auth token create --scopes read:packages"
    echo_blue "After running the command and copying the token, paste it below."
    echo ""
else
    echo_blue "\nPlease ensure you have an existing PAT with 'read:packages' scope."
fi

prompt_input "Enter your GitHub PAT (Personal Access Token) for GHCR" GH_PAT true

if [ -z "$GH_PAT" ]; then
    echo_red "GitHub PAT cannot be empty."
    exit 1
fi

echo_blue "\nUpdating $CONFIG_FILE..."

# Create a backup
cp "$CONFIG_FILE" "${CONFIG_FILE}.bak"
echo_green "Backup of $CONFIG_FILE created at ${CONFIG_FILE}.bak"

# New GHCR entry
NEW_GHCR_ENTRY=$(jq -n --arg name "ghcr" \
                       --arg url "https://ghcr.io" \
                       --arg user "$GH_USER" \
                       --arg pass "$GH_PAT" \
                       --arg catalog "disabled" \
                       '{name: $name, registryUrl: $url, username: $user, password: $pass, catalogPath: $catalog}')

# Read current config and update/add the ghcr entry
TEMP_CONFIG=$(mktemp)
if jq '.ociBackends | map(if .name == "ghcr" then $new_entry else . end)' --argjson new_entry "$NEW_GHCR_ENTRY" "$CONFIG_FILE" > "$TEMP_CONFIG"; then
    # Check if ghcr was actually updated (i.e., it existed)
    if ! jq -e '.ociBackends[] | select(.name == "ghcr")' "$TEMP_CONFIG" > /dev/null; then
        # ghcr entry didn't exist, so add it
        echo_warn "'ghcr' backend not found, adding it..."
        jq '.ociBackends += [$new_entry]' --argjson new_entry "$NEW_GHCR_ENTRY" "$CONFIG_FILE" > "$TEMP_CONFIG"
    fi
    
    # Overwrite the original file with the modified temporary file
    mv "$TEMP_CONFIG" "$CONFIG_FILE"
    echo_green "$CONFIG_FILE updated successfully with GHCR configuration."
else
    echo_red "Error updating $CONFIG_FILE with jq. Restoring from backup."
    mv "${CONFIG_FILE}.bak" "$CONFIG_FILE"
    rm -f "$TEMP_CONFIG"
    exit 1
fi

rm -f "$TEMP_CONFIG" # Clean up temp file if mv was successful

echo_blue "\nConfiguration complete."
echo_blue "Please review $CONFIG_FILE to ensure it's correct."
echo_warn "Remember that the PAT is sensitive. Keep it secure."

exit 0 