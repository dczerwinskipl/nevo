using System.Security.Claims;
using FluentAssertions;
using LanguageExt;
using Microsoft.AspNetCore.Http;
using Moq;
using NEvo.Authorization.Users;
using NEvo.Web.Authorization.Claims;
using NEvo.Web.Authorization.Users;
using Xunit;

namespace NEvo.Web.Authorization.Tests.Users;

public class ClaimUserProviderTests
{
    private readonly Mock<IUserClaimsProvider> _userClaimsProviderMock;
    private readonly ClaimUserProvider<Guid> _userProvider;

    public ClaimUserProviderTests()
    {
        _userClaimsProviderMock = new Mock<IUserClaimsProvider>();
        _userProvider = new ClaimUserProvider<Guid>(_userClaimsProviderMock.Object);
    }

    private static Claim CreateClaim(string type, string value)
        => new(type, value);

    [Fact]
    public void GetUser_ShouldReturnUser_WhenClaimsAreValid()
    {
        // Arrange
        var id = Guid.NewGuid();
        var name = "John Doe";
        var claims = new List<Claim>
        {
            CreateClaim("sub", id.ToString()),
            CreateClaim("name", name)
        };
        _userClaimsProviderMock.Setup(p => p.GetUserClaims()).Returns(Option<IEnumerable<Claim>>.Some(claims));

        // Act
        var result = _userProvider.GetUser();

        // Assert
        result.IsSome.Should().BeTrue();
        result.IfSome(c => c.Should().BeEquivalentTo(new User<Guid>(id, name)));
    }

    [Fact]
    public void GetUser_ShouldReturnNone_WhenSubClaimIsMissing()
    {
        // Arrange
        var name = "John Doe";
        var claims = new List<Claim>
        {
            CreateClaim("name", name)
        };
        _userClaimsProviderMock.Setup(p => p.GetUserClaims()).Returns(Option<IEnumerable<Claim>>.Some(claims));

        // Act
        var result = _userProvider.GetUser();

        // Assert
        result.IsSome.Should().BeFalse();
    }

    [Fact]
    public void GetUser_ShouldReturnNone_WhenNameClaimIsMissing()
    {
        // Arrange
        var id = Guid.NewGuid();
        var claims = new List<Claim>
        {
            CreateClaim("sub", id.ToString())
        };
        _userClaimsProviderMock.Setup(p => p.GetUserClaims()).Returns(Option<IEnumerable<Claim>>.Some(claims));

        // Act
        var result = _userProvider.GetUser();

        // Assert
        result.IsSome.Should().BeFalse();
    }

    [Fact]
    public void GetUser_ShouldReturnNone_WhenNoClaimsAvailable()
    {
        // Arrange
        _userClaimsProviderMock.Setup(p => p.GetUserClaims()).Returns(Option<IEnumerable<Claim>>.None);

        // Act
        var result = _userProvider.GetUser();

        // Assert
        result.IsSome.Should().BeFalse();
    }

    [Fact]
    public void GetUser_ShouldReturnNone_WhenSubClaimIsInvalid()
    {
        // Arrange
        var name = "John Doe";
        var claims = new List<Claim>
        {
            CreateClaim("sub", ""),
            CreateClaim("name", name)
        };
        _userClaimsProviderMock.Setup(p => p.GetUserClaims()).Returns(Option<IEnumerable<Claim>>.Some(claims));

        // Act
        var result = _userProvider.GetUser();

        // Assert
        result.IsSome.Should().BeFalse();
    }

    [Fact]
    public void GetUser_ShouldReturnNone_WhenSubClaimIsNotAGuid()
    {
        // Arrange
        var name = "John Doe";
        var claims = new List<Claim>
        {
            CreateClaim("sub", "InvalidGuid"),
            CreateClaim("name", name)
        };
        _userClaimsProviderMock.Setup(p => p.GetUserClaims()).Returns(Option<IEnumerable<Claim>>.Some(claims));

        // Act
        var result = _userProvider.GetUser();

        // Assert
        result.IsSome.Should().BeFalse();
    }

    [Fact]
    public void GetUser_ShouldReturnNone_WhenNameClaimIsEmpty()
    {
        // Arrange
        var id = Guid.NewGuid();
        var claims = new List<Claim>
        {
            CreateClaim("sub", id.ToString()),
        };
        _userClaimsProviderMock.Setup(p => p.GetUserClaims()).Returns(Option<IEnumerable<Claim>>.Some(claims));

        // Act
        var result = _userProvider.GetUser();

        // Assert
        result.IsSome.Should().BeFalse();
    }
}