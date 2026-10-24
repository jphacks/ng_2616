#!/usr/bin/env bash
# Run on the existing Ubuntu VM after reviewing this script. No repository secrets needed.
set -euo pipefail
if command -v docker >/dev/null 2>&1; then
    sudo docker version
    sudo docker compose version
    exit 0
fi
. /etc/os-release
test "$ID" = ubuntu
test "$VERSION_CODENAME" = noble
# Do not uninstall or replace an existing container runtime.
for package in docker.io docker-compose podman-docker containerd runc; do
    if dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'install ok installed'; then
        echo "Existing runtime package $package: manual review required" >&2
        exit 1
    fi
done
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
# Fingerprint published by Docker's official Ubuntu repository.
fingerprint=$(gpg --show-keys --with-colons /etc/apt/keyrings/docker.asc | awk -F: '$1=="fpr" {print $10; exit}')
test "$fingerprint" = 9DC858229FC7DD38854AE2D88D81803C0EBFCD88
sudo chmod a+r /etc/apt/keyrings/docker.asc
architecture=$(dpkg --print-architecture)
printf 'Types: deb\nURIs: https://download.docker.com/linux/ubuntu\nSuites: noble\nComponents: stable\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/docker.asc\n' "$architecture" | sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker version
sudo docker compose version
