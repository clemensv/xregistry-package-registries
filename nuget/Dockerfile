FROM node:23-alpine

# Create app directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY nuget/package.json ./

# Install app dependencies
RUN npm install --production

# Copy shared logging module
COPY shared/ ./shared/

# Bundle app source
COPY nuget/ .

# Create cache and logs directories
RUN mkdir -p cache
RUN mkdir -p /logs

# Set environment variables
ENV NODE_ENV=production
ENV XREGISTRY_NUGET_PORT=3200
ENV PORT=3200

# Document the available configuration options
ENV XREGISTRY_NUGET_LOG=
ENV XREGISTRY_NUGET_QUIET=false
ENV XREGISTRY_NUGET_BASEURL=
ENV XREGISTRY_NUGET_API_KEY=

# Expose the port the app runs on
EXPOSE ${XREGISTRY_NUGET_PORT}

# Define volume for logs
VOLUME ["/logs"]

# Command to run the app
CMD ["node", "server.js"] 