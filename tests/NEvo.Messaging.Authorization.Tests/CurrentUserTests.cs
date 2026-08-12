using LanguageExt;
using Microsoft.Extensions.DependencyInjection;
using NEvo.Authorization.Users;
using NEvo.Messaging.Context;

namespace NEvo.Messaging.Authorization.Tests;

public class CurrentUserTests
{
    // CurrentUser<TId> is internal (AddCurrentUser<TId> is the public registration
    // surface, ICurrentUser<TId> the public consumption surface) — resolved through DI,
    // same precedent AggregateDecider's own registration test already established.
    private static ICurrentUser<Guid> Build(IMessageContextAccessor accessor)
    {
        var services = new ServiceCollection();
        services.AddSingleton<IMessageContextAccessor>(accessor);
        services.AddCurrentUser<Guid>();
        return services.BuildServiceProvider().GetRequiredService<ICurrentUser<Guid>>();
    }

    [Fact]
    public void User_MessageContextHasAPopulatedUserContext_ReturnsSomeUser()
    {
        var expected = new User<Guid>(Guid.NewGuid(), "someone");
        var contextMock = new Mock<IMessageContext>();
        contextMock.Setup(c => c.GetFeature<UserContext<Guid>>())
            .Returns(new UserContext<Guid> { User = expected });
        var accessor = new MessageContextAccessor { MessageContext = contextMock.Object };

        var currentUser = Build(accessor);

        currentUser.User.Should().BeSome().Which.Should().Be(expected);
    }

    [Fact]
    public void User_MessageContextHasNoUser_ReturnsNone()
    {
        var contextMock = new Mock<IMessageContext>();
        contextMock.Setup(c => c.GetFeature<UserContext<Guid>>())
            .Returns(new UserContext<Guid>());
        var accessor = new MessageContextAccessor { MessageContext = contextMock.Object };

        var currentUser = Build(accessor);

        currentUser.User.Should().BeNone();
    }

    [Fact]
    public void User_NoCurrentMessageContext_ReturnsNone()
    {
        var currentUser = Build(new MessageContextAccessor());

        currentUser.User.Should().BeNone();
    }

    [Fact]
    public void ICurrentUser_ExposesNoMemberBeyondUser()
    {
        typeof(ICurrentUser<>).GetProperties().Should().ContainSingle()
            .Which.Name.Should().Be(nameof(ICurrentUser<Guid>.User));
        typeof(ICurrentUser<>).GetMethods().Should().ContainSingle(m => m.Name == "get_User");
    }
}
