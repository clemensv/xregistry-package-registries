FROM node:20-alpine

# Create app directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package.json ./

# Install app dependencies
RUN npm install --production

# Bundle app source
COPY . .

# Create cache directory
RUN mkdir -p cache

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose the port the app runs on
EXPOSE 3000

# Command to run the app
CMD ["node", "server.js"] 