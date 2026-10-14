# Docker Setup Guide

This guide covers deploying EventEase on EC2 using Docker.

## Prerequisites

- EC2 instance with Docker and Docker Compose installed (DONE)
- MongoDB Atlas account (DONE)
- Git installed on EC2 (DONE)

## Deploy on EC2

SSH into your EC2 instance (detailed in our google drive, .pem file & ip):

```bash
ssh -i your-key.pem ubuntu@your-ec2-ip

cd ~
git clone https://github.com/weehwa/eventease_grp6.git
cd eventease_grp6

cp .env.example .env
nano .env
```

Fill in required variables:

```
NODE_ENV=production
MONGODB_URI=mongodb+srv://eventease_admin:PASSWORD@cluster.mongodb.net/eventease?retryWrites=true&w=majority
MONGODB_DATABASE=eventease
CLIENT_URL=https://eventease.ddns.net
VITE_API_URL=https://eventease.ddns.net
JWT_SECRET=<generate-with-node-e-of-crypto>
```

To generate JWT_SECRET:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Save and exit `.env` file.

## Start Docker

```bash
docker compose build
docker compose up -d

# Check status
docker compose ps

# View logs
docker compose logs -f
```

## Verify Deployment

Test backend:
```bash
curl https://eventease.ddns.net/api/events
```

Open frontend in browser:
```
https://eventease.ddns.net
```

## Container Management

```bash
docker compose logs -f server       # View backend logs
docker compose logs -f client       # View frontend logs
docker compose stop                 # Stop all containers
docker compose restart              # Restart containers
docker compose down                 # Stop and remove containers
docker compose up -d --build        # Rebuild and restart
```

## Troubleshooting

- Check logs with `docker compose --profile production logs`
- Verify .env has all required variables
- Ensure MongoDB Atlas IP whitelist includes your EC2 IP
- Make sure the EC2 security group allows public ports 80 and 443
- Wait 10-15 seconds for containers to start fully

## Update and Redeploy

```bash
git pull origin main
docker compose --profile production up -d --build
```

## Production HTTPS

Production runs Caddy in the `production` Compose profile. Caddy terminates
HTTPS for `eventease.ddns.net`, renews its certificate automatically, and
forwards traffic to the frontend Nginx container. Nginx continues to serve the
React application and proxy `/api` requests to the backend.

The GitHub Actions deployment enables this profile automatically. Caddy's
certificate data is stored in the persistent `caddy-data` volume. The frontend
and backend host ports bind only to loopback and are not directly public.

For production container management, add `--profile production` after
`docker compose` so commands also include the Caddy service.
