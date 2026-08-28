FROM python:3.12-slim

WORKDIR /app

# Install system dependencies for cloudscraper/playwright
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libffi-dev && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy bridge files
COPY bridge.py .
COPY login_helper.py* ./

EXPOSE 5001

CMD ["python", "bridge.py"]
