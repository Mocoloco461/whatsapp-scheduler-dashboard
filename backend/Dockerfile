FROM ghcr.io/puppeteer/puppeteer:21.5.2

# User is pptruser by default in this image
USER root

# Create app directory
WORKDIR /app

# Install app dependencies
COPY package*.json ./
# Install dependencies as root, then switch back if needed, 
# but for simplicity in this setup we might stay as root or ensure permissions
RUN npm install

# Bundle app source
COPY . .

# Fix permissions for pptruser (optional if running as root, but good for cleanup)
# RUN chown -R pptruser:pptruser /app

# Run as root to avoid permission issues with volumes
USER root

# Expose port
EXPOSE 3000

# Start command
CMD [ "node", "index.js" ]
