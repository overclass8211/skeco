function getUserId(req) {
  const id = parseInt(req.headers['x-user-id']);
  return Number.isFinite(id) && id > 0 ? id : null;
}

module.exports = { getUserId };
