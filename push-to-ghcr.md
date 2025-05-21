# Pushing the PyPI xRegistry Docker Image to GitHub Container Registry

Here's a step-by-step guide to manually push your Docker image to the GitHub Container Registry:

## Prerequisites
- Docker installed and running
- Git installed
- A GitHub Personal Access Token (PAT) with `write:packages` permission

## Steps

### 1. Build the Docker Image

From the repository root:

```bash
cd pypi
docker build -t pypi-xregistry .
```

### 2. Tag the Docker Image for GitHub Container Registry

Replace `YOUR-GITHUB-USERNAME` with your GitHub username:

```bash
docker tag pypi-xregistry ghcr.io/YOUR-GITHUB-USERNAME/xregistry-package-registries/pypi-xregistry:latest
```

### 3. Log in to GitHub Container Registry

```bash
# You'll be prompted for your PAT
docker login ghcr.io -u YOUR-GITHUB-USERNAME
```

### 4. Push the Image

```bash
docker push ghcr.io/YOUR-GITHUB-USERNAME/xregistry-package-registries/pypi-xregistry:latest
```

### 5. Verify the Package on GitHub

Go to https://github.com/YOUR-GITHUB-USERNAME/xregistry-package-registries/packages to see your published package.

## Making the Package Public (Optional)

By default, packages on GitHub Container Registry are private. To make it public:

1. Navigate to the package on GitHub
2. Go to Package settings
3. Scroll down to "Danger Zone"
4. Change the visibility to "Public"

## Using the Image

Once pushed, you can use the image in any Docker environment with:

```bash
docker pull ghcr.io/YOUR-GITHUB-USERNAME/xregistry-package-registries/pypi-xregistry:latest
docker run -p 3000:3000 ghcr.io/YOUR-GITHUB-USERNAME/xregistry-package-registries/pypi-xregistry:latest
```

## Notes

- Make sure your GitHub PAT has the necessary permissions: `write:packages`
- The package name must match the repository name where you push it (GitHub requirement)
- If you're using GitHub Actions, this process is automated by the workflows we've already created 