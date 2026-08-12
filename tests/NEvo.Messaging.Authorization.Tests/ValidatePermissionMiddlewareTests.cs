using LanguageExt;
using Microsoft.Extensions.DependencyInjection;
using NEvo.Authorization.Permissions;
using NEvo.Authorization.Users;
using NEvo.Messaging.Context;
using NEvo.Messaging.Handling;

namespace NEvo.Messaging.Authorization.Tests;

public class ValidatePermissionMiddlewareTests
{
    private static readonly IServiceProvider ServiceProvider = new ServiceCollection().BuildServiceProvider();

    private static IMessageContext BuildContext(params IPermission[] permissions)
    {
        var contextMock = new Mock<IMessageContext>();
        contextMock.Setup(c => c.GetFeature<UserContext<Guid, User<Guid>>>())
            .Returns(new UserContext<Guid, User<Guid>> { UserPermissions = permissions });
        return contextMock.Object;
    }

    private static IMessageHandler BuildHandler(Type messageType, System.Reflection.MethodInfo? method)
    {
        var description = new MessageHandlerDescription("key", typeof(object), messageType, null, Method: method);
        var handlerMock = new Mock<IMessageHandler>();
        handlerMock.Setup(h => h.HandlerDescription).Returns(description);
        return handlerMock.Object;
    }

    private static Func<Task<Either<Exception, object>>> Next()
        => () => Task.FromResult(Either<Exception, object>.Right((object)Unit.Default));

    // Simulates the ES convention Fallback route, where HandlerDescription.Method is
    // null — this is the exact defect the fix targets: permission resolution for the
    // selected route must not depend on Method being the domain operation method.
    [Fact]
    public async Task ExecuteAsync_MessageLevelPermissionRequired_NoHandlerMethod_UserLacksPermission_Denies()
    {
        var middleware = new ValidatePermissionMiddleware<Guid, User<Guid>>(ServiceProvider);
        var handler = BuildHandler(typeof(RequiresMessagePermissionCommand), method: null);
        var context = BuildContext();

        var result = await middleware.ExecuteAsync(handler, new RequiresMessagePermissionCommand(), context, Next(), CancellationToken.None);

        result.Should().BeLeft();
    }

    [Fact]
    public async Task ExecuteAsync_MessageLevelPermissionRequired_NoHandlerMethod_UserHasPermission_Allows()
    {
        var middleware = new ValidatePermissionMiddleware<Guid, User<Guid>>(ServiceProvider);
        var handler = BuildHandler(typeof(RequiresMessagePermissionCommand), method: null);
        var context = BuildContext(new Permission<MessageLevelScope>("message-permission", new MessageLevelScope()));

        var result = await middleware.ExecuteAsync(handler, new RequiresMessagePermissionCommand(), context, Next(), CancellationToken.None);

        result.Should().BeRight();
    }

    [Fact]
    public async Task ExecuteAsync_MessageAndHandlerPermissionsRequired_UserHasOnlyMessageLevel_DeniesOnTheHandlerLevelRequirement()
    {
        var method = typeof(HandlerWithPermission).GetMethod(nameof(HandlerWithPermission.HandleAsync));
        var middleware = new ValidatePermissionMiddleware<Guid, User<Guid>>(ServiceProvider);
        var handler = BuildHandler(typeof(RequiresMessagePermissionCommand), method);
        var context = BuildContext(new Permission<MessageLevelScope>("message-permission", new MessageLevelScope()));

        var result = await middleware.ExecuteAsync(handler, new RequiresMessagePermissionCommand(), context, Next(), CancellationToken.None);

        result.Should().BeLeft();
    }

    [Fact]
    public async Task ExecuteAsync_MessageAndHandlerPermissionsRequired_UserHasOnlyHandlerLevel_DeniesOnTheMessageLevelRequirement()
    {
        var method = typeof(HandlerWithPermission).GetMethod(nameof(HandlerWithPermission.HandleAsync));
        var middleware = new ValidatePermissionMiddleware<Guid, User<Guid>>(ServiceProvider);
        var handler = BuildHandler(typeof(RequiresMessagePermissionCommand), method);
        var context = BuildContext(new Permission<HandlerLevelScope>("handler-permission", new HandlerLevelScope()));

        var result = await middleware.ExecuteAsync(handler, new RequiresMessagePermissionCommand(), context, Next(), CancellationToken.None);

        result.Should().BeLeft();
    }

    [Fact]
    public async Task ExecuteAsync_MessageAndHandlerPermissionsRequired_UserHasBoth_Allows()
    {
        var method = typeof(HandlerWithPermission).GetMethod(nameof(HandlerWithPermission.HandleAsync));
        var middleware = new ValidatePermissionMiddleware<Guid, User<Guid>>(ServiceProvider);
        var handler = BuildHandler(typeof(RequiresMessagePermissionCommand), method);
        var context = BuildContext(
            new Permission<MessageLevelScope>("message-permission", new MessageLevelScope()),
            new Permission<HandlerLevelScope>("handler-permission", new HandlerLevelScope())
        );

        var result = await middleware.ExecuteAsync(handler, new RequiresMessagePermissionCommand(), context, Next(), CancellationToken.None);

        result.Should().BeRight();
    }

    // Regression: a plain message with no [AllowPermission] of its own, and a handler
    // method that does carry one, must behave exactly as before message-level
    // attributes existed — the message-level requirement set is empty, so it imposes
    // no restriction on its own.
    [Fact]
    public async Task ExecuteAsync_OnlyHandlerLevelPermissionRequired_UserLacksIt_Denies()
    {
        var method = typeof(HandlerWithPermission).GetMethod(nameof(HandlerWithPermission.HandleAsync));
        var middleware = new ValidatePermissionMiddleware<Guid, User<Guid>>(ServiceProvider);
        var handler = BuildHandler(typeof(PlainCommand), method);
        var context = BuildContext();

        var result = await middleware.ExecuteAsync(handler, new PlainCommand(), context, Next(), CancellationToken.None);

        result.Should().BeLeft();
    }

    [Fact]
    public async Task ExecuteAsync_OnlyHandlerLevelPermissionRequired_UserHasIt_Allows()
    {
        var method = typeof(HandlerWithPermission).GetMethod(nameof(HandlerWithPermission.HandleAsync));
        var middleware = new ValidatePermissionMiddleware<Guid, User<Guid>>(ServiceProvider);
        var handler = BuildHandler(typeof(PlainCommand), method);
        var context = BuildContext(new Permission<HandlerLevelScope>("handler-permission", new HandlerLevelScope()));

        var result = await middleware.ExecuteAsync(handler, new PlainCommand(), context, Next(), CancellationToken.None);

        result.Should().BeRight();
    }

    [Fact]
    public async Task ExecuteAsync_NoAttributesAnywhere_Allows()
    {
        var middleware = new ValidatePermissionMiddleware<Guid, User<Guid>>(ServiceProvider);
        var handler = BuildHandler(typeof(PlainCommand), method: null);
        var context = BuildContext();

        var result = await middleware.ExecuteAsync(handler, new PlainCommand(), context, Next(), CancellationToken.None);

        result.Should().BeRight();
    }

    // Permission denial uses a typed failure so transports can distinguish it from
    // ordinary application errors without inspecting exception messages — asserting the
    // concrete type matters here, not just BeLeft().
    [Fact]
    public async Task ExecuteAsync_PermissionDenied_ReturnsUnauthorizedAccessExceptionDerivedType_NotThrown()
    {
        var middleware = new ValidatePermissionMiddleware<Guid, User<Guid>>(ServiceProvider);
        var handler = BuildHandler(typeof(RequiresMessagePermissionCommand), method: null);
        var context = BuildContext();

        var result = await middleware.ExecuteAsync(handler, new RequiresMessagePermissionCommand(), context, Next(), CancellationToken.None);

        result.Should().BeLeft().Which.Should().BeOfType<PermissionDeniedException>()
            .Which.Should().BeAssignableTo<UnauthorizedAccessException>();
    }
}
