const express = require('express');
const User = require('../../models/User');
const Blacklist = require('../../models/Blacklist');
const jwt = require('jsonwebtoken');

const router = express.Router();

// GET: api.tick-it.com/auth/signin
// GET: api.tick-it.com/auth/callback

const DASHBOARD_URL = 'http://localhost:5173';

router.get('/signin', (req, res) => {
  res.redirect(
    `https://discord.com/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A3001%2Fauth%2Fcallback&scope=guilds+identify`
  );
});

router.get('/callback', async (req, res) => {
  const DISCORD_ENDPOINT = 'https://discord.com/api/v10';
  const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
  const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
  const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;

  const { code } = req.query;

  if (!code) {
    return res.status(400).json({
      error: 'A "code" query parameter must be present in the URL.',
    });
  }

  const oauthRes = await fetch(`${DISCORD_ENDPOINT}/oauth2/token`, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
      code,
    }).toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  if (!oauthRes.ok) {
    console.log('error', oauthRes);
    res.send('error');
    return;
  }

  const oauthResJson = await oauthRes.json();

  const userRes = await fetch(`${DISCORD_ENDPOINT}/users/@me`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Bearer ${oauthResJson.access_token}`,
    },
  });

  if (!userRes.ok) {
    return res.send('error');
  }

  const userResJson = await userRes.json();

  let user = await User.findOne({ id: userResJson.id });

  if (!user) {
    user = new User({
      id: userResJson.id,
      username: userResJson.username,
      avatarHash: userResJson.avatar,
      accessToken: oauthResJson.access_token,
      refreshToken: oauthResJson.refresh_token,
    });
  } else {
    user.username = userResJson.username;
    user.avatarHash = userResJson.avatar;
    user.accessToken = oauthResJson.access_token;
    user.refreshToken = oauthResJson.refresh_token;
  }

  await user.save();

  const token = jwt.sign(
    {
      id: userResJson.id,
      username: userResJson.username,
      avatarHash: userResJson.avatar,
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res
    .status(200)
    .cookie('token', token, {
      domain: 'localhost',
      httpOnly: true,
      // expires: new Date(Date.now() + 6.048e8),
      secure: process.env.NODE_ENV === 'development',
      maxAge: 6.048e8,
      // sameSite: ''
    })
    .redirect(DASHBOARD_URL);
});

router.get('/signout', async (req, res) => {
  const token = req.cookies.token;

  // Clear cookie regardless of token presence
  if (!token) {
    res.clearCookie('token', { httpOnly: true, secure: true });
    return res.status(200).json({ message: 'Successfully logged out. No active session found.' });
  }

  try {
    // Verify the token
    const savedToken = await Blacklist.findOne({ blacklistToken: token });
    if (savedToken) {
      res.clearCookie('token', { httpOnly: true, secure: true });
      return res.status(200).json({ message: 'Successfully logged out. Active session found and already blocked.' });
    }
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Add token to blacklist
    await Blacklist.create({ blacklistToken: token, user_id: decodedToken.id });

    res.clearCookie('token', { httpOnly: true, secure: true });
    return res.status(200).json({ message: 'Successfully logged out.' });
  } catch (err) {
    // Handle invalid token or verification errors
    if (err) {
      res.clearCookie('token', { httpOnly: true, secure: true });
      return res.status(200).json({ message: 'Successfully logged out. Invalid or expired session token.' });
    }

    return res.status(500).json({ message: 'Error during logout. Please try again later.' });
  }
});

module.exports = router;
