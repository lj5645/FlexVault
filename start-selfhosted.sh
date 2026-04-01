#!/bin/bash

echo "Starting NodeWarden Self-Hosted Server..."
echo

if [ ! -f .env ]; then
    echo "Creating .env file from example..."
    cp .env.selfhosted.example .env
    echo
    echo "Please edit .env file with your configuration and run again."
    echo
    ${EDITOR:-nano} .env
    exit 1
fi

echo "Loading environment from .env..."
export $(grep -v '^#' .env | xargs)

echo
echo "Starting server..."
node dist/src/selfhosted/index.js
