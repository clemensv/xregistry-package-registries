FROM node:23-alpine

# Create app directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY maven/package.json ./

# Install app dependencies
RUN npm install --production

# Copy shared logging module
COPY shared/ ./shared/

# Bundle app source
COPY maven/ .

# Create cache and logs directories
RUN mkdir -p cache
RUN mkdir -p /logs

# Set environment variables
ENV NODE_ENV=production
ENV XREGISTRY_MAVEN_PORT=3300
ENV PORT=3300

# Document the available configuration options
ENV XREGISTRY_MAVEN_LOG=
ENV XREGISTRY_MAVEN_QUIET=false
ENV XREGISTRY_MAVEN_BASEURL=
ENV XREGISTRY_MAVEN_API_KEY=

# Expose the port the app runs on
EXPOSE ${XREGISTRY_MAVEN_PORT}

# Define volume for logs
VOLUME ["/logs"]

# Command to run the app
CMD ["node", "server.js"] 