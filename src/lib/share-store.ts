import { ObjectId } from "mongodb";
import { getDatabase } from "@/lib/mongodb";
import { readBoard } from "@/lib/board-store";
import type { BoardView, PlatformUser } from "@/lib/types";

/** Shared views are re-keyed so they cannot collide with the recipient's own view ids. */
export const SHARED_VIEW_ID_PREFIX = "shared:";

type ShareDocument = {
  ownerId: ObjectId;
  viewId: string;
  sharedWithId: ObjectId;
  createdAt: Date;
};

type UserNameDocument = {
  username: string;
};

let shareIndexesPromise: Promise<void> | null = null;

async function ensureShareIndexes(): Promise<void> {
  if (!shareIndexesPromise) {
    shareIndexesPromise = (async () => {
      const db = await getDatabase();
      const shares = db.collection<ShareDocument>("shares");
      await shares.createIndex(
        { ownerId: 1, viewId: 1, sharedWithId: 1 },
        { unique: true },
      );
      await shares.createIndex({ sharedWithId: 1 });
    })();
  }

  await shareIndexesPromise;
}

function toObjectId(value: string): ObjectId | null {
  return ObjectId.isValid(value) ? new ObjectId(value) : null;
}

export function buildSharedViewId(ownerId: string, viewId: string): string {
  return `${SHARED_VIEW_ID_PREFIX}${ownerId}:${viewId}`;
}

export function isSharedViewId(viewId: string): boolean {
  return viewId.startsWith(SHARED_VIEW_ID_PREFIX);
}

async function findUsernames(
  userIds: ObjectId[],
): Promise<Map<string, string>> {
  if (userIds.length === 0) {
    return new Map();
  }

  const db = await getDatabase();
  const users = await db
    .collection<UserNameDocument>("users")
    .find({ _id: { $in: userIds } }, { projection: { username: 1 } })
    .toArray();

  return new Map(users.map((user) => [user._id.toHexString(), user.username]));
}

export async function listUsernamesByIds(
  userIds: string[],
): Promise<Map<string, string>> {
  const objectIds = userIds
    .map((userId) => toObjectId(userId))
    .filter((objectId): objectId is ObjectId => objectId !== null);

  return findUsernames(objectIds);
}

/** Every other customer on the platform, so the owner can pick who to share with. */
export async function listPlatformUsers(
  excludeUserId: string,
): Promise<PlatformUser[]> {
  const db = await getDatabase();
  const excludeId = toObjectId(excludeUserId);

  const users = await db
    .collection<UserNameDocument>("users")
    .find(excludeId ? { _id: { $ne: excludeId } } : {}, {
      projection: { username: 1 },
      sort: { username: 1 },
    })
    .toArray();

  return users.map((user) => ({
    id: user._id.toHexString(),
    username: user.username,
  }));
}

export async function listViewRecipients(
  ownerId: string,
  viewId: string,
): Promise<PlatformUser[]> {
  await ensureShareIndexes();
  const ownerObjectId = toObjectId(ownerId);
  if (!ownerObjectId) return [];

  const db = await getDatabase();
  const shares = await db
    .collection<ShareDocument>("shares")
    .find({ ownerId: ownerObjectId, viewId })
    .toArray();

  const usernames = await findUsernames(
    shares.map((share) => share.sharedWithId),
  );

  return shares
    .map((share) => {
      const id = share.sharedWithId.toHexString();
      const username = usernames.get(id);
      return username ? { id, username } : null;
    })
    .filter((recipient): recipient is PlatformUser => recipient !== null)
    .sort((a, b) => a.username.localeCompare(b.username));
}

async function ownerHasView(ownerId: string, viewId: string): Promise<boolean> {
  const workspace = await readBoard(ownerId);
  return workspace.views.some((view) => view.id === viewId);
}

export async function shareView(
  ownerId: string,
  viewId: string,
  recipientUserId: string,
): Promise<void> {
  const ownerObjectId = toObjectId(ownerId);
  const recipientObjectId = toObjectId(recipientUserId);

  if (!ownerObjectId || !recipientObjectId) {
    throw new Error("Unknown user.");
  }

  if (ownerObjectId.equals(recipientObjectId)) {
    throw new Error("You already own this dashboard.");
  }

  if (isSharedViewId(viewId)) {
    throw new Error("You can only share dashboards you own.");
  }

  if (!(await ownerHasView(ownerId, viewId))) {
    throw new Error("Dashboard not found.");
  }

  const db = await getDatabase();
  const recipient = await db
    .collection<UserNameDocument>("users")
    .findOne({ _id: recipientObjectId });

  if (!recipient) {
    throw new Error("Unknown user.");
  }

  await ensureShareIndexes();
  await db.collection<ShareDocument>("shares").updateOne(
    { ownerId: ownerObjectId, viewId, sharedWithId: recipientObjectId },
    { $setOnInsert: { createdAt: new Date() } },
    { upsert: true },
  );
}

export async function unshareView(
  ownerId: string,
  viewId: string,
  recipientUserId: string,
): Promise<void> {
  const ownerObjectId = toObjectId(ownerId);
  const recipientObjectId = toObjectId(recipientUserId);

  if (!ownerObjectId || !recipientObjectId) {
    return;
  }

  await ensureShareIndexes();
  const db = await getDatabase();
  await db.collection<ShareDocument>("shares").deleteOne({
    ownerId: ownerObjectId,
    viewId,
    sharedWithId: recipientObjectId,
  });
}

/** Drops share records for views the owner has since deleted. */
export async function pruneSharesForMissingViews(
  ownerId: string,
  existingViewIds: string[],
): Promise<void> {
  const ownerObjectId = toObjectId(ownerId);
  if (!ownerObjectId) return;

  await ensureShareIndexes();
  const db = await getDatabase();
  await db
    .collection<ShareDocument>("shares")
    .deleteMany({ ownerId: ownerObjectId, viewId: { $nin: existingViewIds } });
}

/** Read-only copies of the dashboards other customers shared with this user. */
export async function readSharedViewsForUser(
  userId: string,
): Promise<BoardView[]> {
  await ensureShareIndexes();
  const userObjectId = toObjectId(userId);
  if (!userObjectId) return [];

  const db = await getDatabase();
  const shares = await db
    .collection<ShareDocument>("shares")
    .find({ sharedWithId: userObjectId })
    .toArray();

  if (shares.length === 0) {
    return [];
  }

  const ownerIds = [
    ...new Map(
      shares.map((share) => [share.ownerId.toHexString(), share.ownerId]),
    ).values(),
  ];
  const usernames = await findUsernames(ownerIds);

  const workspaces = new Map(
    await Promise.all(
      ownerIds.map(
        async (ownerId) =>
          [ownerId.toHexString(), await readBoard(ownerId.toHexString())] as const,
      ),
    ),
  );

  const sharedViews: BoardView[] = [];

  for (const share of shares) {
    const ownerId = share.ownerId.toHexString();
    const ownerUsername = usernames.get(ownerId);
    const view = workspaces
      .get(ownerId)
      ?.views.find((candidate) => candidate.id === share.viewId);

    if (!ownerUsername || !view) {
      continue;
    }

    sharedViews.push({
      ...view,
      id: buildSharedViewId(ownerId, view.id),
      sharedBy: ownerUsername,
      sharedByUserId: ownerId,
      sourceViewId: view.id,
    });
  }

  return sharedViews.sort((a, b) => {
    const owner = (a.sharedBy ?? "").localeCompare(b.sharedBy ?? "");
    return owner !== 0 ? owner : a.name.localeCompare(b.name);
  });
}
