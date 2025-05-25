FROM node:23-alpine

# Create app directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package.json ./

# Install app dependencies
RUN npm install --production

# Copy shared logging module
COPY shared/ ../shared/

# Bundle app source
COPY . .

# Create cache and logs directories
RUN mkdir -p cache
RUN mkdir -p /logs

# Set environment variables
ENV NODE_ENV=production
ENV XREGISTRY_PYPI_PORT=3000
ENV PORT=3000

# Document the available configuration options
ENV XREGISTRY_PYPI_LOG=
ENV XREGISTRY_PYPI_QUIET=false
ENV XREGISTRY_PYPI_BASEURL=
ENV XREGISTRY_PYPI_API_KEY=

# Expose the port the app runs on
EXPOSE ${XREGISTRY_PYPI_PORT}

# Define volume for logs
VOLUME ["/logs"]

# Command to run the app
CMD ["node", "server.js"] 