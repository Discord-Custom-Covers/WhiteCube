# WhiteCube
A Discord bot for managing USRBGs.

# This is a fucking mess
I'm very aware.

# How do I deploy that shit?
Either A. You don't. or B. Copy `.env.example` to `.env` and modify it to your liking, then do `npm install` and `node src/index.js`. Note that you'll probably not have access to the admin commands by default, so you'll need to add them to the database. Consider using `prisma studio` to modify all of that stuff.