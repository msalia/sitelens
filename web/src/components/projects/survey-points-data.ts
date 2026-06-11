import { graphql } from '@/lib/gql';

export const SURVEY_POINTS = graphql(`
  query SurveyPoints(
    $id: UUID!
    $search: String
    $cat: UUID
    $group: UUID
    $limit: Int
    $offset: Int
    $sort: String
    $descending: Boolean
  ) {
    surveyPoints(
      projectId: $id
      search: $search
      categoryId: $cat
      groupId: $group
      limit: $limit
      offset: $offset
      sort: $sort
      descending: $descending
    ) {
      id
      projectId
      label
      northing
      easting
      elevation
      description
      categoryId
      tags
      importBatchId
    }
    surveyPointCount(projectId: $id, search: $search, categoryId: $cat, groupId: $group)
  }
`);
export const DELETE_SURVEY_POINT = graphql(`
  mutation DeleteSurveyPoint($id: UUID!) {
    deleteSurveyPoint(id: $id)
  }
`);
export const BULK_DELETE = graphql(`
  mutation DeleteSurveyPoints($ids: [UUID!]!) {
    deleteSurveyPoints(ids: $ids)
  }
`);
export const ASSIGN_CATEGORY = graphql(`
  mutation AssignCategory($ids: [UUID!]!, $cat: UUID) {
    assignCategory(ids: $ids, categoryId: $cat)
  }
`);
export const CREATE_POINT_GROUP = graphql(`
  mutation CreatePointGroup($id: UUID!, $name: String!, $ids: [UUID!]!) {
    createPointGroup(projectId: $id, name: $name, memberIds: $ids) {
      id
    }
  }
`);
export const POINT_GROUPS = graphql(`
  query PointGroups($id: UUID!) {
    pointGroups(projectId: $id) {
      id
      projectId
      name
      memberIds
    }
  }
`);
export const ADD_TO_GROUP = graphql(`
  mutation AddPointsToGroup($groupId: UUID!, $ids: [UUID!]!) {
    addPointsToGroup(groupId: $groupId, memberIds: $ids) {
      id
      memberIds
    }
  }
`);
