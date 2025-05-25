# Use an official Node.js runtime as a parent image
FROM node:18-slim

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install app dependencies
RUN npm install --omit=dev

# Copy shared logging module
COPY shared/ ../shared/

# Copy the rest of the application code to the working directory
COPY . .

# Make port 3000 available to the world outside this container
EXPOSE 3000

# Define environment variables
ENV NODE_ENV production
ENV PORT 3000
ENV XREGISTRY_LOG_LEVEL info
ENV XREGISTRY_CACHE_DIR ./cache
ENV XREGISTRY_OCI_BACKENDS "[]"

# Run the app when the container launches
CMD [ "npm", "start" ] 