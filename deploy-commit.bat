@echo off
echo 🚀 Committing and deploying xRegistry resource allocation fix...

echo 📝 Adding all changes...
git add .

echo 📤 Committing changes...
git commit -m "Deploy: Fix resource allocation math - 1.75 CPU + 3.5 GB exactly matches Azure limits"

echo 🌐 Pushing to trigger deployment...
git push

echo ✅ Changes pushed! Deployment should trigger automatically.
echo 💡 Monitor at: https://github.com/clemensv/xregistry-package-registries/actions

pause 