#!/bin/bash
# Build xRegistry Viewer and start bridge with viewer enabled

set -e

SKIP_VIEWER_BUILD=false
PRODUCTION=false
API_PATH_PREFIX="/registry"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-viewer-build)
            SKIP_VIEWER_BUILD=true
            shift
            ;;
        --production)
            PRODUCTION=true
            shift
            ;;
        --api-path-prefix)
            API_PATH_PREFIX="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--skip-viewer-build] [--production] [--api-path-prefix <path>]"
            exit 1
            ;;
    esac
done

echo "🚀 xRegistry Viewer Integration Setup"
echo ""

# Navigate to repository root
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

# Check if viewer submodule is initialized
if [ ! -d "viewer/.git" ]; then
    echo "📦 Initializing viewer submodule..."
    git submodule update --init --recursive
fi

# Build viewer if not skipped
if [ "$SKIP_VIEWER_BUILD" = false ]; then
    echo "🔨 Building xRegistry Viewer..."
    cd viewer
    
    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        echo "📦 Installing viewer dependencies..."
        npm install
    fi
    
    # Build Angular app
    echo "⚙️  Building Angular app..."
    if [ "$PRODUCTION" = true ]; then
        npm run build -- --configuration production
    else
        npm run build
    fi
    
    echo "✅ Viewer built successfully"
    cd "$REPO_ROOT"
else
    echo "⏭️  Skipping viewer build"
fi

# Check if viewer dist exists
if [ ! -f "viewer/dist/xregistry-viewer/index.html" ]; then
    echo "❌ Viewer dist not found. Run without --skip-viewer-build first."
    exit 1
fi

echo ""
echo "🎯 Starting bridge with viewer enabled..."
echo "   Viewer: http://localhost:8080/viewer/"
echo "   API:    http://localhost:8080${API_PATH_PREFIX}/"
echo ""

# Set environment variables and start bridge
cd bridge

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing bridge dependencies..."
    npm install
fi

# Set environment variables
export VIEWER_ENABLED="true"
export VIEWER_PROXY_ENABLED="true"
export API_PATH_PREFIX="$API_PATH_PREFIX"
export PORT="8080"

echo "🚀 Starting server..."
npm run dev
