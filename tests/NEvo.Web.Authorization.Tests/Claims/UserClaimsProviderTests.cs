using System.Security.Claims;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Moq;
using NEvo.Web.Authorization.Claims;
using Xunit;

namespace NEvo.Web.Authorization.Tests.Claims;

public class UserClaimsProviderTests
{
    private readonly Mock<IHttpContextAccessor> _httpContextAccessorMock;
    private readonly UserClaimsProvider _userClaimsProvider;

    public UserClaimsProviderTests()
    {
        _httpContextAccessorMock = new Mock<IHttpContextAccessor>();
        _userClaimsProvider = new UserClaimsProvider(_httpContextAccessorMock.Object);
    }

    [Fact]
    public void GetUserClaims_ShouldReturnClaims_WhenUserIsAuthenticated()
    {
        // Arrange
        var claims = new List<Claim>
        {
            new(ClaimTypes.Name, "TestUser"),
            new(ClaimTypes.Email, "testuser@example.com")
        };
        var identity = new ClaimsIdentity(claims, "TestAuthType");
        var claimsPrincipal = new ClaimsPrincipal(identity);
        var httpContext = new DefaultHttpContext { User = claimsPrincipal };

        _httpContextAccessorMock.Setup(x => x.HttpContext).Returns(httpContext);

        // Act
        var result = _userClaimsProvider.GetUserClaims();

        // Assert
        result.IsSome.Should().BeTrue();
        result.IfSome(c => c.Should().BeEquivalentTo(claims, options => options
            .Excluding(claim => claim.Subject)
            .Excluding(claim => claim.Properties)
            .Excluding(claim => claim.OriginalIssuer)
            .Excluding(claim => claim.Issuer)
            .Excluding(claim => claim.ValueType)));
    }

    [Fact]
    public void GetUserClaims_ShouldReturnNone_WhenUserIsNotAuthenticated()
    {
        // Arrange
        var httpContext = new DefaultHttpContext { User = null };
        _httpContextAccessorMock.Setup(x => x.HttpContext).Returns(httpContext);

        // Act
        var result = _userClaimsProvider.GetUserClaims();

        // Assert
        result.IsNone.Should().BeTrue();
    }
}