#!/bin/bash

# Script to configure Docker Hub backend in oci/config.json

CONFIG_FILE="oci/config.json"
JQ_CMD=$(command -v jq)
DOCKER_CMD=$(command -v docker)

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

# Function to extract credentials from docker config
extract_docker_credentials() {
    local docker_config_file
    if [ -n "$HOME" ]; then
        docker_config_file="$HOME/.docker/config.json"
    else
        docker_config_file="$USERPROFILE/.docker/config.json"
    fi

    if [ ! -f "$docker_config_file" ]; then
        return 1
    fi

    # Check for Docker Hub credentials
    local docker_hub_auth
    docker_hub_auth=$(jq -r '.auths["https://index.docker.io/v1/"].auth // empty' "$docker_config_file" 2>/dev/null)
    
    if [ -z "$docker_hub_auth" ]; then
        # Try alternative format
        docker_hub_auth=$(jq -r '.auths["index.docker.io"].auth // empty' "$docker_config_file" 2>/dev/null)
    fi

    if [ -n "$docker_hub_auth" ]; then
        # Decode base64 credentials
        local decoded_creds
        decoded_creds=$(echo "$docker_hub_auth" | base64 -d 2>/dev/null)
        if [ $? -eq 0 ] && [[ "$decoded_creds" == *":"* ]]; then
            DOCKER_USER="${decoded_creds%%:*}"
            DOCKER_PASS="${decoded_creds#*:}"
            return 0
        fi
    fi

    # Check for credential helpers
    local creds_store
    creds_store=$(jq -r '.credsStore // empty' "$docker_config_file" 2>/dev/null)
    if [ -n "$creds_store" ]; then
        echo_warn "Docker is configured to use credential store '$creds_store'."
        echo_warn "You may need to use 'docker login' first or enter credentials manually."
        return 1
    fi

    local cred_helpers
    cred_helpers=$(jq -r '.credHelpers["index.docker.io"] // .credHelpers["https://index.docker.io/v1/"] // empty' "$docker_config_file" 2>/dev/null)
    if [ -n "$cred_helpers" ]; then
        echo_warn "Docker is configured to use credential helper '$cred_helpers' for Docker Hub."
        echo_warn "You may need to use 'docker login' first or enter credentials manually."
        return 1
    fi

    return 1
}

# --- Pre-flight Checks ---
if [ -z "$JQ_CMD" ]; then
    echo_red "Error: jq is not installed or not in PATH. Please install jq to continue."
    echo_blue "On macOS: brew install jq"
    echo_blue "On Debian/Ubuntu: sudo apt-get install jq"
    exit 1
fi

if [ ! -f "$CONFIG_FILE" ]; then
    echo_red "Error: Configuration file $CONFIG_FILE not found."
    echo_blue "Please ensure you are in the correct directory or create a default config file first."
    exit 1
fi

# --- Main Logic ---
echo_blue "This script will help you configure the Docker Hub backend in $CONFIG_FILE."
echo_warn "If you use 2FA for Docker Hub, you should generate an Access Token and use it as the password."
echo ""

# Check if Docker CLI is available and user is logged in
if [ -n "$DOCKER_CMD" ]; then
    echo_blue "Docker CLI detected. Checking for existing Docker Hub authentication..."
    
    # Try to extract credentials from Docker config
    if extract_docker_credentials; then
        echo_green "Found existing Docker Hub credentials in Docker configuration."
        echo_blue "Username: $DOCKER_USER"
        echo_blue "Password/Token: $(echo "$DOCKER_PASS" | sed 's/./*/g')"
        echo ""
        prompt_input "Use these credentials? (y/N)" USE_EXISTING false
        if [[ "$USE_EXISTING" =~ ^[Yy]$ ]]; then
            echo_green "Using existing Docker credentials."
        else
            DOCKER_USER=""
            DOCKER_PASS=""
        fi
    else
        echo_warn "No Docker Hub credentials found in Docker configuration."
        echo_blue "You can either:"
        echo_blue "  1. Run 'docker login' first to authenticate with Docker Hub"
        echo_blue "  2. Enter credentials manually below"
        echo ""
        prompt_input "Do you want to run 'docker login' now? (y/N)" DO_LOGIN false
        if [[ "$DO_LOGIN" =~ ^[Yy]$ ]]; then
            echo_blue "Running 'docker login'..."
            if docker login; then
                echo_green "Docker login successful. Re-extracting credentials..."
                if extract_docker_credentials; then
                    echo_green "Successfully extracted credentials from Docker config."
                else
                    echo_warn "Could not extract credentials. Please enter them manually."
                fi
            else
                echo_red "Docker login failed. Please enter credentials manually."
            fi
        fi
    fi
fi

# If we still don't have credentials, prompt for them
if [ -z "$DOCKER_USER" ]; then
    echo_blue "Manual credential entry:"
    prompt_input "Enter your Docker Hub username (leave blank for anonymous/public access)" DOCKER_USER false
fi

if [ -n "$DOCKER_USER" ] && [ -z "$DOCKER_PASS" ]; then
    prompt_input "Enter your Docker Hub password or Access Token (leave blank if none)" DOCKER_PASS true
fi

echo_blue "\nUpdating $CONFIG_FILE..."

# Create a backup
cp "$CONFIG_FILE" "${CONFIG_FILE}.bak"
echo_green "Backup of $CONFIG_FILE created at ${CONFIG_FILE}.bak"

# New Docker Hub entry
NEW_DOCKERHUB_ENTRY=$(jq -n --arg name "dockerhub" \
                           --arg url "https://registry-1.docker.io" \
                           --arg user "$DOCKER_USER" \
                           --arg pass "$DOCKER_PASS" \
                           --arg catalog "/v2/_catalog" \
                           '{name: $name, registryUrl: $url, username: $user, password: $pass, catalogPath: $catalog}')

# Read current config and update/add the dockerhub entry
TEMP_CONFIG=$(mktemp)
if jq '.ociBackends | map(if .name == "dockerhub" then $new_entry else . end)' --argjson new_entry "$NEW_DOCKERHUB_ENTRY" "$CONFIG_FILE" > "$TEMP_CONFIG"; then
    # Check if dockerhub was actually updated (i.e., it existed)
    if ! jq -e '.ociBackends[] | select(.name == "dockerhub")' "$TEMP_CONFIG" > /dev/null; then
        # dockerhub entry didn't exist, so add it
        echo_warn "'dockerhub' backend not found, adding it..."
        jq '.ociBackends += [$new_entry]' --argjson new_entry "$NEW_DOCKERHUB_ENTRY" "$CONFIG_FILE" > "$TEMP_CONFIG"
    fi
    
    # Overwrite the original file with the modified temporary file
    mv "$TEMP_CONFIG" "$CONFIG_FILE"
    echo_green "$CONFIG_FILE updated successfully with Docker Hub configuration."
else
    echo_red "Error updating $CONFIG_FILE with jq. Restoring from backup."
    mv "${CONFIG_FILE}.bak" "$CONFIG_FILE"
    rm -f "$TEMP_CONFIG"
    exit 1
fi

rm -f "$TEMP_CONFIG" # Clean up temp file if mv was successful

echo_blue "\nConfiguration complete."
echo_blue "Please review $CONFIG_FILE to ensure it's correct."
if [ -n "$DOCKER_PASS" ]; then
    echo_warn "Remember that your Docker Hub password/token is sensitive. Keep it secure."
fi

echo_blue "\nNext steps:"
echo_blue "1. Test your configuration by running: cd oci && npm start"
echo_blue "2. Try accessing: http://localhost:3000/containerregistries/dockerhub/images"
echo_blue "3. Consider using Docker Hub Access Tokens instead of passwords for better security"

exit 0 