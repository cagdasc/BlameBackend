package com.cacaosd.networkinspector.apollo

import kotlin.test.Test
import kotlin.test.assertEquals

class ApolloUrlSanitizerTest {
    @Test
    fun removesCredentialsQueryAndFragmentButKeepsHostAndPath() {
        assertEquals(
            "https://example.test:8443/graphql/path",
            ApolloUrlSanitizer.sanitize(
                "https://user:password@example.test:8443/graphql/path?token=private#fragment"
            ),
        )
    }

    @Test
    fun handlesUrlsWithoutAuthorityAndQuery() {
        assertEquals("/graphql", ApolloUrlSanitizer.sanitize("/graphql?query=private#fragment"))
        assertEquals("https://example.test/graphql", ApolloUrlSanitizer.sanitize("https://example.test/graphql"))
    }
}
