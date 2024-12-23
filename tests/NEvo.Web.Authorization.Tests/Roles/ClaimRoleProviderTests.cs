using System.Security.Claims;
using FluentAssertions;
using LanguageExt;
using Moq;
using NEvo.Authorization;
using NEvo.Web.Authorization.Claims;
using NEvo.Web.Authorization.Roles;
using Xunit;

namespace NEvo.Web.Authorization.Tests.Roles;

public class ClaimRoleProviderTests
{
    private readonly Mock<IUserClaimsProvider> _userClaimsProviderMock;
    private readonly ClaimRoleProvider<CustomDataScope> _roleProvider;

    public ClaimRoleProviderTests()
    {
        _userClaimsProviderMock = new Mock<IUserClaimsProvider>();
        _roleProvider = new ClaimRoleProvider<CustomDataScope>(_userClaimsProviderMock.Object);
    }

    [Fact]
    public void GetRoles_ShouldReturnRoles_WhenRoleClaimIsValidJson()
    {
        // Arrange
        var claims = new List<Claim> {
            CreateRoleClaim("""{ "Name": "Admin", "DataScope": { "ClientId": 1 } }"""),
            CreateRoleClaim("""{ "Name": "Manager", "DataScope": { "ClientId": 2 } }""")
        };
        _userClaimsProviderMock.Setup(p => p.GetUserClaims()).Returns(Option<IEnumerable<Claim>>.Some(claims));

        // Act
        var result = _roleProvider.GetRoles();

        // Assert
        result.Should().HaveCount(2);
        result.Should().Contain(r => r.Name == "Admin" && r.DataScope.ClientId == 1);
        result.Should().Contain(r => r.Name == "Manager" && r.DataScope.ClientId == 2);
    }

    [Fact]
    public void GetRoles_ShouldReturnEmpty_WhenRoleClaimIsEmptyJson()
    {
        // Arrange
        var rolesJson = "{}";
        var claims = new List<Claim> { CreateRoleClaim(rolesJson) };
        _userClaimsProviderMock.Setup(p => p.GetUserClaims()).Returns(Option<IEnumerable<Claim>>.Some(claims));

        // Act
        var result = _roleProvider.GetRoles();

        // Assert
        result.Should().BeEmpty();
    }

    [Fact]
    public void GetRoles_ShouldReturnEmpty_WhenRoleClaimIsMissing()
    {
        // Arrange
        var claims = new List<Claim>();
        _userClaimsProviderMock.Setup(p => p.GetUserClaims()).Returns(Option<IEnumerable<Claim>>.Some(claims));

        // Act
        var result = _roleProvider.GetRoles();

        // Assert
        result.Should().BeEmpty();
    }

    [Fact]
    public void GetRoles_ShouldReturnEmpty_WhenRoleClaimIsInvalidJson()
    {
        // Arrange
        var invalidJson = "{ invalidJson: ";
        var claims = new List<Claim> { CreateRoleClaim(invalidJson) };
        _userClaimsProviderMock.Setup(p => p.GetUserClaims()).Returns(Option<IEnumerable<Claim>>.Some(claims));

        // Act
        var result = _roleProvider.GetRoles();

        // Assert
        result.Should().BeEmpty();
    }

    private static Claim CreateRoleClaim(string json)
        => new("role", json);

    private record CustomDataScope(int ClientId) : AuthDataScope;
}