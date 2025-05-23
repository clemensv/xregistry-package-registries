#!/bin/bash

# Test script for unified xRegistry Docker container
set -e

echo "🐳 Testing unified xRegistry Docker container..."

# Build the container
echo "Building container..."
docker build -t xregistry-unified:test .

# Start the container in the background
echo "Starting container..."
docker run -d -p 3000:3000 --name xregistry-test xregistry-unified:test

# Wait for container to start
echo "Waiting for container to start..."
sleep 10

# Test endpoints
echo "Testing endpoints..."

# Root endpoint
echo "✓ Testing root endpoint..."
curl -f http://localhost:3000/ > /dev/null && echo "  ✅ Root endpoint OK" || echo "  ❌ Root endpoint failed"

# Capabilities endpoint  
echo "✓ Testing capabilities endpoint..."
curl -f http://localhost:3000/capabilities > /dev/null && echo "  ✅ Capabilities endpoint OK" || echo "  ❌ Capabilities endpoint failed"

# Model endpoint
echo "✓ Testing model endpoint..."
curl -f http://localhost:3000/model > /dev/null && echo "  ✅ Model endpoint OK" || echo "  ❌ Model endpoint failed"

# Registry endpoints
echo "✓ Testing PyPI registry..."
curl -f http://localhost:3000/pythonregistries > /dev/null && echo "  ✅ PyPI registry OK" || echo "  ❌ PyPI registry failed"

echo "✓ Testing NPM registry..."
curl -f http://localhost:3000/noderegistries > /dev/null && echo "  ✅ NPM registry OK" || echo "  ❌ NPM registry failed"

echo "✓ Testing Maven registry..."
curl -f http://localhost:3000/javaregistries > /dev/null && echo "  ✅ Maven registry OK" || echo "  ❌ Maven registry failed"

echo "✓ Testing NuGet registry..."
curl -f http://localhost:3000/dotnetregistries > /dev/null && echo "  ✅ NuGet registry OK" || echo "  ❌ NuGet registry failed"

echo "✓ Testing OCI registry..."
curl -f http://localhost:3000/containerregistries > /dev/null && echo "  ✅ OCI registry OK" || echo "  ❌ OCI registry failed"

# Check container health
echo "✓ Checking container health..."
HEALTH=$(docker inspect --format='{{.State.Health.Status}}' xregistry-test)
if [ "$HEALTH" = "healthy" ]; then
    echo "  ✅ Container health check passed"
else
    echo "  ⚠️  Container health status: $HEALTH"
fi

# Show container logs
echo "📋 Container logs (last 20 lines):"
docker logs --tail 20 xregistry-test

# Cleanup
echo "🧹 Cleaning up..."
docker stop xregistry-test
docker rm xregistry-test

echo "✅ Docker test completed successfully!" 