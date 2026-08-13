using LanguageExt;
using Microsoft.Extensions.DependencyInjection;
using NEvo.Authorization.Users;
using NEvo.Messaging.Context;

namespace NEvo.Messaging.Authorization.Tests;

public class CurrentUserTests
{
    // CurrentUser<TId,TUser> is internal — AddCurrentUser<TId,TUser> is the public
    // registration surface and ICurrentUser<TId,TUser> is the public consumption
    // surface, so it is resolved through DI rather than constructed directly.
    private static ICurrentUser<Guid, User<Guid>> Build(IMessageContextAccessor accessor)
    {
        var services = new ServiceCollection();
        services.AddSingleton<IMessageContextAccessor>(accessor);
        services.AddCurrentUser<Guid, User<Guid>>();
        return services.BuildServiceProvider().GetRequiredService<ICurrentUser<Guid, User<Guid>>>();
    }

    [Fact]
    public void User_MessageContextHasAPopulatedUserContext_ReturnsUser()
    {
        var expected = new User<Guid>(Guid.NewGuid(), "someone");
        var contextMock = new Mock<IMessageContext>();
        contextMock.Setup(c => c.GetFeature<UserContext<Guid, User<Guid>>>())
            .Returns(new UserContext<Guid, User<Guid>> { User = expected });
        var accessor = new MessageContextAccessor { MessageContext = contextMock.Object };

        var currentUser = Build(accessor);

        currentUser.User.Should().Be(expected);
    }

    // Resolving ICurrentUser<,> (constructing CurrentUser<,>) must itself fail when no
    // user is available — not merely reading .User afterward — so a DI-backed resolver
    // (e.g. task 13's decision-method parameter resolver) observes the failure during
    // activation, before any caller could hold a partially-usable instance.
    [Fact]
    public void Resolve_MessageContextHasNoUser_ThrowsCurrentUserUnavailableDuringActivation()
    {
        var contextMock = new Mock<IMessageContext>();
        contextMock.Setup(c => c.GetFeature<UserContext<Guid, User<Guid>>>())
            .Returns(new UserContext<Guid, User<Guid>>());
        var accessor = new MessageContextAccessor { MessageContext = contextMock.Object };

        FluentActions.Invoking(() => Build(accessor)).Should().Throw<CurrentUserUnavailableException>();
    }

    [Fact]
    public void Resolve_NoCurrentMessageContext_ThrowsCurrentUserUnavailableDuringActivation()
    {
        FluentActions.Invoking(() => Build(new MessageContextAccessor())).Should().Throw<CurrentUserUnavailableException>();
    }

    [Fact]
    public void ICurrentUser_ExposesNoMemberBeyondUser()
    {
        typeof(ICurrentUser<,>).GetProperties().Should().ContainSingle()
            .Which.Name.Should().Be(nameof(ICurrentUser<Guid, User<Guid>>.User));
        typeof(ICurrentUser<,>).GetMethods().Should().ContainSingle(m => m.Name == "get_User");
    }
}
