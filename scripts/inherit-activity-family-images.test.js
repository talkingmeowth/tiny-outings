import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFamilyImageInheritances, familyInheritanceSql } from './inherit-activity-family-images.js';

function activity(overrides = {}) {
  return {
    activity_id: crypto.randomUUID(),
    activity_name: 'Baby Sensory Dulwich',
    address: 'Dulwich, London SE21 7LD',
    organiser_website: 'https://www.babysensory.com/dulwich/',
    public_listing_status: 'published',
    archive: false,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

test('inherits the highest-priority established family cover at other locations', () => {
  const admin = activity({
    activity_id: '00000000-0000-4000-8000-000000000001',
    activity_name: 'Baby Sensory Southwark',
    address: 'Southwark, London SE1 1AA',
    admin_cover_image_url: 'https://images.test/canonical.jpg',
  });
  const automatic = activity({
    activity_id: '00000000-0000-4000-8000-000000000002',
    model_selected_url: 'https://images.test/old-model.jpg',
  });
  const result = buildFamilyImageInheritances([admin, automatic]);
  assert.equal(result.updates.length, 1);
  assert.equal(result.updates[0].image_url, admin.admin_cover_image_url);
  assert.equal(result.updates[0].donor_field, 'admin_cover_image_url');
  assert.match(familyInheritanceSql(result), /model_selected_model = 'activity-family-inheritance'/);
  assert.match(familyInheritanceSql(result), /not exists \([\s\S]*activity_photos/);
});

test('does not overwrite manual choices, uploads, category art, or quick approvals', () => {
  const donor = activity({
    activity_id: '00000000-0000-4000-8000-000000000001',
    address: 'Southwark, London SE1 1AA',
    admin_cover_image_url: 'https://images.test/canonical.jpg',
  });
  const protectedRows = [
    activity({ activity_id: '00000000-0000-4000-8000-000000000002', reviewed_image_url: 'https://images.test/reviewed.jpg' }),
    activity({ activity_id: '00000000-0000-4000-8000-000000000003', user_uploaded_image_url: 'https://images.test/upload.jpg', address: 'Croydon, CR0' }),
    activity({ activity_id: '00000000-0000-4000-8000-000000000004', use_category_image: true, address: 'Bromley, BR1' }),
    activity({ activity_id: '00000000-0000-4000-8000-000000000005', image_review_approved_at: '2026-09-02T00:00:00Z', address: 'Lewisham, SE13' }),
  ];
  assert.equal(buildFamilyImageInheritances([donor, ...protectedRows]).updates.length, 0);
});

test('created-after scopes new targets while allowing an older established donor', () => {
  const result = buildFamilyImageInheritances([
    activity({
      activity_id: '00000000-0000-4000-8000-000000000001',
      address: 'Southwark, London SE1 1AA',
      created_at: '2026-08-01T00:00:00Z',
      admin_cover_image_url: 'https://images.test/canonical.jpg',
    }),
    activity({ activity_id: '00000000-0000-4000-8000-000000000002', created_at: '2026-09-10T00:00:00Z' }),
  ], { createdAfter: '2026-09-09T00:00:00Z' });
  assert.equal(result.updates.length, 1);
  assert.equal(result.updates[0].donor_activity_id, '00000000-0000-4000-8000-000000000001');
});

test('does not group an unrelated directory activity with the official franchise', () => {
  const result = buildFamilyImageInheritances([
    activity({
      activity_id: '00000000-0000-4000-8000-000000000001',
      address: 'Southwark, London SE1 1AA',
      admin_cover_image_url: 'https://images.test/canonical.jpg',
    }),
    activity({
      activity_id: '00000000-0000-4000-8000-000000000002',
      activity_name: 'Quaggy Baby Sensory Stay and Play',
      address: 'Greenwich, London SE10 8RE',
      organiser_website: '',
      website: 'https://www.royalgreenwich.gov.uk/community-directory/quaggy',
    }),
  ]);
  assert.equal(result.updates.length, 0);
});

test('uses the highest-confidence existing automatic image as the family donor', () => {
  const result = buildFamilyImageInheritances([
    activity({
      activity_id: '00000000-0000-4000-8000-000000000001',
      activity_name: 'Mini Mozart Baby Class',
      address: 'Southwark, London SE1 1AA',
      organiser_website: 'https://minimozart.com/',
      model_selected_url: 'https://images.test/stronger.jpg',
      model_selected_confidence: 0.9,
    }),
    activity({
      activity_id: '00000000-0000-4000-8000-000000000002',
      activity_name: 'Mini Mozart Baby Class',
      address: 'Dulwich, London SE21 7LD',
      organiser_website: 'https://minimozart.com/',
      model_selected_url: 'https://images.test/weaker.jpg',
      model_selected_confidence: 0.7,
    }),
  ]);
  assert.equal(result.updates[0].image_url, 'https://images.test/stronger.jpg');
});
