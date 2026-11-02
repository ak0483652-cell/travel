# Impression India: Vercel (frontend) + Render (backend)

impression-india/
  frontend/  -> Vercel (static site)
  backend/   -> Render (Node/Express API)

## 1. Database (MongoDB Atlas, free)
1. Create a free cluster at mongodb.com/atlas.
2. Database Access: add a user + password.
3. Network Access: allow 0.0.0.0/0.
4. Connect -> Drivers -> copy the connection string (this is MONGODB_URI).
   Add a db name: ...mongodb.net/impression?retryWrites=true&w=majority

## 2. Backend on Render
1. Push the `backend` folder to a GitHub repo (or the whole project, then set Root Directory = backend).
2. Render -> New -> Web Service -> pick repo.
   Build Command: npm install    Start Command: npm start
3. Environment variables:
   MONGODB_URI, ADMIN_PASSWORD (your admin login), TOKEN_SECRET (long random string),
   FRONTEND_URL (your Vercel URL, set after step 3; redeploy)
4. Copy the Render URL, e.g. https://impression-api.onrender.com

## 3. Frontend on Vercel
1. Open frontend/index.html, set API_URL to your Render URL.
2. Push the `frontend` folder to GitHub, Vercel -> Add New Project -> import it (Root Directory = frontend, no build).
3. Copy the Vercel URL into Render's FRONTEND_URL and redeploy backend.

## Admin
Open https://your-site.vercel.app/#admin and log in with ADMIN_PASSWORD.

Note: Render free plan sleeps after 15 min idle, so the first enquiry/login can take ~30-50 sec.
