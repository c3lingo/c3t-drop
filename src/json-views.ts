import { type Talk } from './models/talks';

export async function index({
  talks,
  isAuthorized = false,
}: {
  talks: InstanceType<Talk>[];
  isAuthorized?: boolean;
}) {
  return {
    talks: talks.map((talk) => ({
      id: talk.id,
      title: talk.title,
      fileCount: talk.files.length,
      commentCount: talk.commentFiles.length,
      url: `/talks/${talk.id}`,
    })),
    isAuthorized,
  };
}

export async function talk({
  talk,
  isAuthorized = false,
}: {
  talk: InstanceType<Talk>;
  isAuthorized?: boolean;
}) {
  return {
    isAuthorized,
    id: talk.id,
    title: talk.title,
    fileCount: talk.files.length,
    commentCount: talk.commentFiles.length,
    files: talk.files.map((file) => ({
      name: isAuthorized ? file.name : null,
      redactedName: file.redactedName,
      url: null,
      meta: {
        size: file.meta.stats?.size,
        created: file.meta.stats?.birthtime,
        hash: file.meta.hash,
      },
    })),
    comments: isAuthorized
      ? (await talk.getComments()).map((comment) => ({
          body: comment.body.toString(),
          meta: {
            created: comment.info.stats?.birthtime,
          },
        }))
      : null,
    zipUrl: null,
  };
}
