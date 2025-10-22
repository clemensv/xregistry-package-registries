#!/bin/bash
# Check for accidentally committed secrets

echo "🔍 Checking for secrets in git repository..."

declare -A patterns=(
    ["dckr_pat_[A-Za-z0-9_]+"]="Docker Personal Access Token"
    ["ghp_[A-Za-z0-9_]+"]="GitHub Personal Access Token"
    ["glpat-[A-Za-z0-9_-]+"]="GitLab Personal Access Token"
    ["\"password\"[[:space:]]*:[[:space:]]*\"[^\"]{8,}\""]="Password field"
    ["\"token\"[[:space:]]*:[[:space:]]*\"[^\"]{8,}\""]="Token field"
    ["DOCKER_PASSWORD=.+"]="Docker password in file"
    ["GHCR_TOKEN=.+"]="GitHub token in file"
)

found_secrets=0

for pattern in "${!patterns[@]}"; do
    name="${patterns[$pattern]}"
    echo ""
    echo "Searching for: $name"
    
    if git grep -n -E "$pattern" 2>/dev/null; then
        found_secrets=1
        echo "❌ FOUND POTENTIAL SECRET: $name"
    fi
done

if [ $found_secrets -eq 1 ]; then
    echo ""
    echo "❌ SECRETS DETECTED IN REPOSITORY!"
    echo "⚠️  Please remove these secrets immediately:"
    echo "  1. Revoke the exposed tokens/passwords"
    echo "  2. Remove from git history using git filter-branch or BFG"
    echo "  3. Generate new credentials"
    echo "  4. Update your .env file (which is git-ignored)"
    echo ""
    echo "📖 See SECURITY.md for detailed instructions"
    exit 1
else
    echo ""
    echo "✅ No secrets detected in repository"
    echo "👍 Good job keeping credentials secure!"
    exit 0
fi
