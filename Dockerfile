# Stage 1: Build the dependencies
FROM python:3.11-slim as builder

WORKDIR /app

# Install system dependencies that might be needed by Python packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy only the requirements file to leverage Docker cache
COPY requirements.txt .

# Install Python dependencies
RUN pip wheel --no-cache-dir --wheel-dir /app/wheels -r requirements.txt

# Stage 2: Create the final, lightweight image
FROM python:3.11-slim

WORKDIR /app

# Copy the installed dependencies from the builder stage
COPY --from=builder /app/wheels /app/wheels

# Install the dependencies from the wheelhouse
RUN pip install --no-cache /app/wheels/*

# Copy the rest of the application code
COPY . .

# Set the command to run the bot
CMD ["python3", "bot_enhanced.py"]
