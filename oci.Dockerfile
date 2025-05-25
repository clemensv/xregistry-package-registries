# Use an official Node.js runtime as a parent image
FROM node:23-alpine

# Create app directory
WORKDIR /app

# Copy package.json and package-lock.json (if available)
COPY oci/package*.json ./

# Install app dependencies
RUN npm install --omit=dev

# Copy shared logging module to parent directory so ../shared/logging/logger works
COPY shared/ ../shared/

# Copy the rest of the application code to the working directory
COPY oci/ .

# Make port 3000 available to the world outside this container
EXPOSE 3000

# Set environment variables for OCI registry configuration
ENV XREGISTRY_OCI_PORT=3000
ENV PORT=3000
ENV XREGISTRY_OCI_LOG=
ENV XREGISTRY_OCI_QUIET=false
ENV XREGISTRY_OCI_BASEURL=
ENV XREGISTRY_OCI_API_KEY=

# Run the OCI registry when the container launches
CMD ["node", "server.js"] 