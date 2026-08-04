import { Metric, Profile } from './types';

// --- Mock data for Phase 1 ---
// Only metrics that Instagram's OFFICIAL Graph API can legitimately provide
// (for a Business/Creator account), or that we can compute ourselves by
// snapshotting follower counts over time. The fabricated "ghost followers /
// blocked you / admirers / profile stalkers" cards from the original app are
// intentionally omitted — Instagram does not expose that data.

export const mockProfile: Profile = {
  username: 'fitxvert',
  fullName: 'Richie Campano | Personal Trainer',
  avatarUrl: 'https://i.pravatar.cc/300?img=12',
  followers: 105,
  following: 99,
};

// 'api'     -> available directly from Graph API insights
// 'tracked' -> we derive it by storing daily follower-count snapshots locally
export const mockMetrics: Metric[] = [
  { key: 'followers', label: 'Followers', value: 105, delta: 23, trend: 'up', source: 'tracked' },
  { key: 'following', label: 'Following', value: 99, delta: 2, trend: 'down', source: 'api' },
  { key: 'posts', label: 'Posts', value: 14, source: 'api' },
  { key: 'profileViews', label: 'Profile Views (7d)', value: 63, delta: 9, trend: 'up', source: 'api' },
  { key: 'reach', label: 'Reach (7d)', value: 218, delta: 31, trend: 'up', source: 'api' },
  { key: 'impressions', label: 'Impressions (7d)', value: 412, delta: 12, trend: 'up', source: 'api' },
  { key: 'engagement', label: 'Engagement Rate', value: 6.2, unit: '%', delta: 0.4, trend: 'up', source: 'api' },
  { key: 'storyInteractions', label: 'Story Interactions', value: 85, delta: 5, trend: 'up', source: 'api' },
  { key: 'newFollowers', label: 'New Followers (7d)', value: 23, source: 'tracked' },
  { key: 'lostFollowers', label: 'Lost Followers (7d)', value: 6, source: 'tracked' },
  { key: 'avgLikes', label: 'Avg Likes / Post', value: 47, source: 'api' },
  { key: 'avgComments', label: 'Avg Comments / Post', value: 8, source: 'api' },
];
