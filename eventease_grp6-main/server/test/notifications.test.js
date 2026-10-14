const {
  api,
  createUser,
  tokenFor,
  randomEmail,
  models: { Notification },
} = require('./helpers');

describe('Notifications API', () => {
  test('lists notifications for the user', async () => {
    const user = await createUser({ name: 'Notif User', email: randomEmail('notif') });
    const token = tokenFor(user);
    await Notification.create({
      user: user._id,
      kind: 'test',
      title: 'Hello there',
      body: 'A notification',
    });

    const res = await api.get('/api/notifications', token);
    expect(res.status).toBe(200);
    expect(res.body.data.notifications.length).toBe(1);
    expect(res.body.data.notifications[0].title).toBe('Hello there');
  });
});