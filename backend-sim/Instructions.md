# Exact steps to run the simulator on Ubuntu

Starting from the StoneGate project root where the shared/protocol folder
and the frontend files are located (the canvas contents).

## Install Node.js (if not already)

```bash
    sudo apt update
    sudo apt install -y curl build-essential
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
```

## Install simulator dependencies and start it

```bash
    cd backend-sim
    npm install
    npm start
```

## Start the frontend (in another terminal)

```bash
    cd StoneGate/frontend
    pnpm install   # or npm install if you prefer
    pnpm dev       # or npm run dev
```
