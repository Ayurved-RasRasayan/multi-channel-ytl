FROM node:18-bullseye-slim

# Install system dependencies: ffmpeg, python3, pip, yt-dlp
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir yt-dlp

WORKDIR /app

# Copy package files and install node dependencies
COPY server/package*.json ./server/
RUN cd server && npm install --production

# Copy repository source files
COPY . .

EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

CMD ["node", "server/server.js"]
