#!/bin/bash
cd "$(dirname "$0")"
source venv/bin/activate
export FLASK_APP=app.py
python3 app.py
