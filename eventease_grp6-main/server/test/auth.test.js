const {
  api,
  createUser,
  tokenFor,
  randomEmail,
  makeReferral,
  models: { User },
} = require('./helpers');

describe('Auth API', () => {
  test('register creates a customer and returns a token', async () => {
    const res = await api.post('/api/auth/register').send({
      name: 'Alice Tan',
      email: randomEmail('alice'),
      password: 'StrongPass123!',
    });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.user.role).toBe('customer');
  });

  test('register rejects a request missing the password', async () => {
    const res = await api.post('/api/auth/register').send({
      name: 'No Password',
      email: randomEmail('nopass'),
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Name, email and password/i);
  });

  test.each([
    ['shorter than 8 characters', 'Ab1!def', /at least 8 characters/i],
    ['no uppercase letter', 'strongpass123!', /uppercase letter/i],
    ['no symbol', 'StrongPass123', /symbol/i],
  ])('register rejects a password with %s', async (_label, password, expected) => {
    const res = await api.post('/api/auth/register').send({
      name: 'Weak Password',
      email: randomEmail('weak'),
      password,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(expected);
  });

  test('register accepts an 8 character password with a capital and a symbol', async () => {
    const res = await api.post('/api/auth/register').send({
      name: 'Edge Policy',
      email: randomEmail('edge'),
      password: 'Abcdef1!',
    });
    expect(res.status).toBe(201);
  });

  test('change-password enforces the same policy', async () => {
    const user = await createUser({ name: 'Policy Change', email: randomEmail('policy') });
    const res = await api
      .post('/api/auth/change-password', tokenFor(user))
      .send({ currentPassword: 'Password123!', newPassword: 'weakpassword!' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/uppercase letter/i);
    expect(await User.findById(user._id).then((u) => u.comparePassword('Password123!'))).toBe(true);
  });

  test('register rejects a duplicate email with 409', async () => {
    const email = randomEmail('dup');
    await api.post('/api/auth/register').send({
      name: 'First',
      email,
      password: 'StrongPass123!',
    });
    const res = await api.post('/api/auth/register').send({
      name: 'Second',
      email,
      password: 'StrongPass123!',
    });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already registered/i);
  });

  describe('referral bonus', () => {
    let referrer;
    let referrerToken;
    const pointsBefore = () => User.findById(referrer._id).then((u) => u.loyaltyPoints);

    beforeEach(async () => {
      referrer = await createUser({ name: 'Referrer Root', email: randomEmail('refroot') });
      referrer.referralCode = makeReferral();
      await referrer.save();
      referrerToken = tokenFor(referrer);
    });

    const registerReferred = (name) =>
      api.post('/api/auth/register').send({
        name,
        email: randomEmail('refd'),
        password: 'StrongPass123!',
        referralCode: referrer.referralCode,
      });

    test('grants both the referrer and the referred user 500 loyalty points', async () => {
      const before = await pointsBefore();
      const res = await registerReferred('Referee Alpha');
      expect(res.status).toBe(201);

      expect(await pointsBefore()).toBe(before + 500);

      const referred = await User.findById(res.body.data.user.id);
      expect(referred.loyaltyPoints).toBe(500);
      expect(res.body.data.user.loyaltyPoints).toBe(500);
    });

    test('rejects an unknown referral code', async () => {
      const res = await api
        .post('/api/auth/register')
        .send({ name: 'Referee Beta', email: randomEmail('refb'), password: 'StrongPass123!', referralCode: 'NOSUCHCODE' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/invalid referral code/i);
    });

    // Regression: the referral bonus used to be a WELCOME-<referralCode> coupon,
    // whose code collided on the unique index for two referred customers whose
    // names shared a prefix, failing the second signup with 409 Duplicate value
    // for code. Signup now credits points and issues nothing, so it must not fail.
    test('allows referred customers sharing a name prefix to all sign up', async () => {
      const first = await registerReferred('Jordan Blake');
      const second = await registerReferred('Jordan Blake');
      const third = await registerReferred('Jordan Black');

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(third.status).toBe(201);

      const codes = await Promise.all(
        [first, second, third].map(async (res) => (await User.findById(res.body.data.user.id)).referralCode)
      );
      expect(new Set(codes).size).toBe(3);
    });
  });

  test('login succeeds with correct credentials', async () => {
    const email = randomEmail('login');
    await createUser({ name: 'Log In', email, password: 'StrongPass123!' });
    const res = await api.post('/api/auth/login').send({ email, password: 'StrongPass123!' });
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.user.email).toBe(email);
  });

  test('login fails with a wrong password', async () => {
    const email = randomEmail('wrongpass');
    await createUser({ name: 'Wrong Pass', email, password: 'StrongPass123!' });
    const res = await api.post('/api/auth/login').send({ email, password: 'WrongPass456' });
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/Invalid credentials/i);
  });

  test('GET /me returns the authenticated user', async () => {
    const user = await createUser({ name: 'Me User', email: randomEmail('me') });
    const res = await api.get('/api/auth/me', tokenFor(user));
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(user.email);
  });

  test('POST /auth/change-password updates the password', async () => {
    const user = await createUser({ name: 'Change Pw', email: randomEmail('pw') });
    const res = await api
      .post('/api/auth/change-password', tokenFor(user))
      .send({ currentPassword: 'Password123!', newPassword: 'BrandNewPass456!' });
    expect(res.status).toBe(200);

    const login = await api
      .post('/api/auth/login')
      .send({ email: user.email, password: 'BrandNewPass456!' });
    expect(login.status).toBe(200);
  });
});