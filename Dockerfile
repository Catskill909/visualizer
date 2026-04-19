# Stage 1: Build the Vite App
FROM node:20-alpine AS build
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source code and build
COPY . .
RUN npm run build

# Stage 2: Serve the App using Nginx Alpine
FROM nginx:alpine
# Install curl for healthchecks
RUN apk add --no-cache curl
# Remove default nginx static assets
RUN rm -rf /usr/share/nginx/html/*

# Copy build assets from stage 1
COPY --from=build /app/dist /usr/share/nginx/html

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 3000
EXPOSE 3000

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]
