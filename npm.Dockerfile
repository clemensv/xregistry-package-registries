FROM node:23-alpine

# Add image identification
LABEL org.xregistry.name="xregistry-npm-bridge"
LABEL org.xregistry.description="xRegistry API wrapper for NPM"

# Create app directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY npm/package.json ./

# Install app dependencies
RUN npm install --production

# Copy shared logging module to parent directory so ../shared/logging/logger works
COPY shared/ ../shared/

# Bundle app source
COPY npm/ .

# Create cache and all-packages directories
RUN mkdir -p cache
RUN mkdir -p all-packages
RUN mkdir -p /logs

# Set environment variables
ENV NODE_ENV=production
ENV XREGISTRY_NPM_PORT=3100
ENV PORT=3100

# Document the available configuration options
ENV XREGISTRY_NPM_LOG=
ENV XREGISTRY_NPM_QUIET=false
ENV XREGISTRY_NPM_BASEURL=
ENV XREGISTRY_NPM_API_KEY=

# Install all-the-package-names in the all-packages directory
WORKDIR /app/all-packages
RUN echo '{"name": "all-packages","version": "1.0.0","description": "Container for all-the-package-names"}' > package.json
RUN npm install all-the-package-names
WORKDIR /app

# Expose the port the app runs on
EXPOSE ${XREGISTRY_NPM_PORT}

# Define volume for logs
VOLUME ["/logs"]

# Command to run the app
CMD ["node", "server.js"] 