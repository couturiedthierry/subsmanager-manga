export const DASHBOARD_QUERY = `#graphql
  query SubsManagerDashboard($withContracts: Boolean!) {
    shop {
      name
      currencyCode
    }
    sellingPlanGroups(first: 5, reverse: true) {
      nodes {
        id
        name
        merchantCode
        productsCount { count }
        sellingPlans(first: 3) {
          nodes { id name }
        }
      }
    }
    subscriptionContracts(first: 50, reverse: true) @include(if: $withContracts) {
      nodes {
        id
        status
        currencyCode
        nextBillingDate
        lastPaymentStatus
        customer { id displayName }
        lines(first: 3) {
          nodes {
            title
            quantity
            lineDiscountedPrice { amount currencyCode }
          }
        }
      }
    }
  }
`;

export const PLANS_QUERY = `#graphql
  query SubsManagerPlans($first: Int!, $after: String) {
    sellingPlanGroups(first: $first, after: $after, reverse: true) {
      nodes {
        id
        name
        merchantCode
        createdAt
        productsCount { count }
        productVariantsCount { count }
        sellingPlans(first: 10) {
          nodes {
            id
            name
            options
            billingPolicy {
              ... on SellingPlanRecurringBillingPolicy { interval intervalCount }
            }
            pricingPolicies {
              ... on SellingPlanFixedPricingPolicy {
                adjustmentType
                adjustmentValue {
                  ... on SellingPlanPricingPolicyPercentageValue { percentage }
                  ... on MoneyV2 { amount currencyCode }
                }
              }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const CREATE_SELLING_PLAN_GROUP = `#graphql
  mutation SubsManagerCreateSellingPlanGroup(
    $input: SellingPlanGroupInput!
    $resources: SellingPlanGroupResourceInput
  ) {
    sellingPlanGroupCreate(input: $input, resources: $resources) {
      sellingPlanGroup { id name merchantCode }
      userErrors { field message }
    }
  }
`;

export const SELLING_PLAN_GROUP_QUERY = `#graphql
  query SubsManagerSellingPlanGroup($id: ID!) {
    sellingPlanGroup(id: $id) {
      id
      name
      merchantCode
      products(first: 250) {
        nodes { id title }
      }
      sellingPlans(first: 10) {
        nodes {
          id
          name
          options
          billingPolicy {
            ... on SellingPlanRecurringBillingPolicy { interval intervalCount }
          }
          pricingPolicies {
            ... on SellingPlanFixedPricingPolicy {
              adjustmentType
              adjustmentValue {
                ... on SellingPlanPricingPolicyPercentageValue { percentage }
              }
            }
          }
        }
      }
    }
  }
`;

export const UPDATE_SELLING_PLAN_GROUP = `#graphql
  mutation SubsManagerUpdateSellingPlanGroup($id: ID!, $input: SellingPlanGroupInput!) {
    sellingPlanGroupUpdate(id: $id, input: $input) {
      sellingPlanGroup { id name merchantCode }
      userErrors { field message }
    }
  }
`;

export const ADD_SELLING_PLAN_PRODUCTS = `#graphql
  mutation SubsManagerAddSellingPlanProducts($id: ID!, $productIds: [ID!]!) {
    sellingPlanGroupAddProducts(id: $id, productIds: $productIds) {
      sellingPlanGroup { id }
      userErrors { field message }
    }
  }
`;

export const REMOVE_SELLING_PLAN_PRODUCTS = `#graphql
  mutation SubsManagerRemoveSellingPlanProducts($id: ID!, $productIds: [ID!]!) {
    sellingPlanGroupRemoveProducts(id: $id, productIds: $productIds) {
      removedProductIds
      userErrors { field message }
    }
  }
`;

export const DELETE_SELLING_PLAN_GROUP = `#graphql
  mutation SubsManagerDeleteSellingPlanGroup($id: ID!) {
    sellingPlanGroupDelete(id: $id) {
      deletedSellingPlanGroupId
      userErrors { field message }
    }
  }
`;

export const SUBSCRIPTIONS_QUERY = `#graphql
  query SubsManagerSubscriptions(
    $first: Int!
    $after: String
    $query: String
  ) {
    subscriptionContracts(
      first: $first
      after: $after
      query: $query
      reverse: true
    ) {
      nodes {
        id
        status
        currencyCode
        nextBillingDate
        lastPaymentStatus
        customer { id displayName }
        originOrder { id name }
        lines(first: 3) {
          nodes {
            title
            quantity
            lineDiscountedPrice { amount currencyCode }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const SUBSCRIPTION_DETAIL_QUERY = `#graphql
  query SubsManagerSubscriptionDetail(
    $id: ID!
    $startDate: DateTime!
    $endDate: DateTime!
  ) {
    shop { name contactEmail }
    subscriptionContract(id: $id) {
      id
      status
      currencyCode
      nextBillingDate
      lastPaymentStatus
      customer {
        id
        displayName
        defaultEmailAddress { emailAddress }
      }
      originOrder { id name createdAt }
      billingPolicy { interval intervalCount }
      deliveryPolicy { interval intervalCount }
      deliveryPrice { amount currencyCode }
      customerPaymentMethod(showRevoked: true) {
        id
        revokedAt
        instrument {
          __typename
          ... on CustomerCreditCard { brand lastDigits expiryMonth expiryYear }
          ... on CustomerShopPayAgreement { lastDigits expiryMonth expiryYear }
          ... on CustomerPaypalBillingAgreement { paypalAccountEmail }
        }
      }
      lines(first: 20) {
        nodes {
          id
          title
          variantTitle
          quantity
          productId
          variantId
          currentPrice { amount currencyCode }
          lineDiscountedPrice { amount currencyCode }
          variantImage { url altText }
        }
      }
      billingAttempts(first: 10, reverse: true) {
        nodes {
          id
          createdAt
          completedAt
          ready
          errorCode
          errorMessage
          order { id name }
        }
      }
    }
    subscriptionBillingCycles(
      contractId: $id
      first: 24
      billingCyclesDateRangeSelector: {
        startDate: $startDate
        endDate: $endDate
      }
    ) {
      nodes {
        cycleIndex
        billingAttemptExpectedDate
        skipped
        status
      }
    }
  }
`;

export const PAUSE_CONTRACT = `#graphql
  mutation SubsManagerPauseContract($subscriptionContractId: ID!) {
    subscriptionContractPause(subscriptionContractId: $subscriptionContractId) {
      contract { id status }
      userErrors { field message }
    }
  }
`;

export const ACTIVATE_CONTRACT = `#graphql
  mutation SubsManagerActivateContract($subscriptionContractId: ID!) {
    subscriptionContractActivate(subscriptionContractId: $subscriptionContractId) {
      contract { id status }
      userErrors { field message }
    }
  }
`;

export const CANCEL_CONTRACT = `#graphql
  mutation SubsManagerCancelContract($subscriptionContractId: ID!) {
    subscriptionContractCancel(subscriptionContractId: $subscriptionContractId) {
      contract { id status }
      userErrors { field message }
    }
  }
`;

export const EDIT_BILLING_CYCLE_SCHEDULE = `#graphql
  mutation SubsManagerEditBillingCycleSchedule(
    $billingCycleInput: SubscriptionBillingCycleInput!
    $input: SubscriptionBillingCycleScheduleEditInput!
  ) {
    subscriptionBillingCycleScheduleEdit(
      billingCycleInput: $billingCycleInput
      input: $input
    ) {
      billingCycle { cycleIndex skipped billingAttemptExpectedDate }
      userErrors { field message }
    }
  }
`;

export const SEND_PAYMENT_UPDATE_EMAIL = `#graphql
  mutation SubsManagerSendPaymentUpdateEmail(
    $customerPaymentMethodId: ID!
    $emailInput: EmailInput
  ) {
    customerPaymentMethodSendUpdateEmail(
      customerPaymentMethodId: $customerPaymentMethodId
      email: $emailInput
    ) {
      customer { id }
      userErrors { field message }
    }
  }
`;

export const CONTRACT_SYNC_FIELDS = `#graphql
  fragment SubsManagerContractSync on SubscriptionContract {
    id
    status
    currencyCode
    nextBillingDate
    lastPaymentStatus
    revisionId
    customer { id displayName }
    lines(first: 10) {
      nodes {
        title
        quantity
        lineDiscountedPrice { amount currencyCode }
      }
    }
  }
`;

// Shopify's subscriptionContracts search does not support next_billing_date, so callers
// page through contracts by status and decide which are due in code.
export const CONTRACTS_PAGE_QUERY = `#graphql
  query SubsManagerContractsPage($query: String, $after: String) {
    subscriptionContracts(first: 100, after: $after, query: $query, reverse: true) {
      nodes { ...SubsManagerContractSync }
      pageInfo { hasNextPage endCursor }
    }
  }
  ${CONTRACT_SYNC_FIELDS}
`;

export const CONTRACT_SYNC_QUERY = `#graphql
  query SubsManagerContractSync($id: ID!) {
    subscriptionContract(id: $id) { ...SubsManagerContractSync }
  }
  ${CONTRACT_SYNC_FIELDS}
`;

export const PLAN_GROUPS_PAGE_QUERY = `#graphql
  query SubsManagerPlanGroupsPage($after: String) {
    shop { name currencyCode }
    sellingPlanGroups(first: 50, after: $after) {
      nodes {
        id
        name
        merchantCode
        productsCount { count }
        sellingPlans(first: 10) { nodes { id name } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const BILLING_ATTEMPT_QUERY = `#graphql
  query SubsManagerBillingAttempt($id: ID!) {
    subscriptionBillingAttempt(id: $id) {
      id
      ready
      errorCode
      errorMessage
      completedAt
      subscriptionContract { id }
      order {
        id
        name
        totalPriceSet { shopMoney { amount currencyCode } }
      }
    }
  }
`;

export const CREATE_BILLING_ATTEMPT = `#graphql
  mutation SubsManagerCreateBillingAttempt(
    $subscriptionContractId: ID!
    $input: SubscriptionBillingAttemptInput!
  ) {
    subscriptionBillingAttemptCreate(
      subscriptionContractId: $subscriptionContractId
      subscriptionBillingAttemptInput: $input
    ) {
      subscriptionBillingAttempt { id ready errorCode errorMessage }
      userErrors { field message code }
    }
  }
`;

export const CUSTOMER_CONTRACT_OWNERSHIP_QUERY = `#graphql
  query SubsManagerCustomerContractOwnership($id: ID!) {
    subscriptionContract(id: $id) {
      id
      customer {
        id
        defaultEmailAddress { emailAddress }
      }
      customerPaymentMethod(showRevoked: false) { id }
    }
  }
`;

export const SHOP_ID_QUERY = `#graphql
  query SubsManagerShopId {
    shop { id }
  }
`;

export const CREATE_SETTINGS_DEFINITION = `#graphql
  mutation SubsManagerCreateSettingsDefinition($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition { id }
      userErrors { field message code }
    }
  }
`;

export const SET_METAFIELDS = `#graphql
  mutation SubsManagerSetMetafields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id }
      userErrors { field message code }
    }
  }
`;
