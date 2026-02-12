interface MatchUserIdentity {
  id: string;
  username: string;
}

export const assignMatchUsernames = (users: MatchUserIdentity[]): string[] => {
  const totalsByName = new Map<string, number>();
  users.forEach((user) => {
    const count = totalsByName.get(user.username) ?? 0;
    totalsByName.set(user.username, count + 1);
  });

  const seenByName = new Map<string, number>();
  return users.map((user) => {
    const total = totalsByName.get(user.username) ?? 0;
    if (total <= 1) {
      return user.username;
    }
    const seen = (seenByName.get(user.username) ?? 0) + 1;
    seenByName.set(user.username, seen);
    return `${user.username}${seen}`;
  });
};
