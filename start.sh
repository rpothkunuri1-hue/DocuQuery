#!/bin/bash

echo "Starting Document Q&A System..."
echo "================================"

echo "Starting Flask backend on port 8000..."
python backend/app.py &
BACKEND_PID=$!

sleep 2

echo "Starting React frontend on port 5000..."
npm start

kill $BACKEND_PID 2>/dev/null
