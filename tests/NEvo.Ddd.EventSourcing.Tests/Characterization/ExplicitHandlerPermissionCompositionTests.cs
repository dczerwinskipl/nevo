using LanguageExt;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using NEvo.Authorization;
using NEvo.Authorization.Permissions;
using NEvo.Ddd.EventSourcing.Handling;
using NEvo.Messaging;
using NEvo.Messaging.Authorization;
using NEvo.Messaging.Context;
using NEvo.Messaging.Cqrs.Commands;
using NEvo.Messaging.Handling;

namespace NEvo.Ddd.EventSourcing.Tests.Characterization;

// Proves message-level and explicit-handler-method permissions compose (AND) through
// the real explicit Event Sourced handler discovery/registration path — not a
// hand-built MessageHandlerDescription.
public class ExplicitHandlerPermissionCompositionTests
{
    public record CommandPermissionScope : AuthDataScope;
    public record HandlerPermissionScope : AuthDataScope;

    public class AlwaysValidValidator<TDataScope> : IDataScopeMessageValidator<TDataScope, Message>
        where TDataScope : AuthDataScope
    {
        public bool Validate(TDataScope dataScope, Message message) => true;
    }

    [AllowPermission("command.permission", typeof(AlwaysValidValidator<CommandPermissionScope>))]
    public record SecuredCommand(Guid DocumentId) : DocumentCommand(DocumentId);

    public class SecuredExplicitEsHandler : IEventSourcedCommandHandler<SecuredCommand, Document, Guid>
    {
        [AllowPermission("handler.permission", typeof(AlwaysValidValidator<HandlerPermissionScope>))]
        public EitherAsync<Exception, IEnumerable<IAggregateEvent<Document, Guid>>> HandleAsync(SecuredCommand command, Option<Document> aggregate, CancellationToken cancellationToken)
            => new IAggregateEvent<Document, Guid>[] { new DocumentChanged(command.DocumentId, "Secured") };
    }

    private static ServiceProvider BuildProvider()
    {
        var services = new ServiceCollection();
        services.AddSingleton(typeof(ILogger<>), typeof(NullLogger<>));
        services.AddMessages();
        services.AddEventSourcing(typeof(Document));
        services.AddScoped<IEventSourcedCommandHandler<SecuredCommand, Document, Guid>, SecuredExplicitEsHandler>();
        services.Configure<MessageHandlerExtractorConfiguration>(options =>
        {
            options.Handlers.Add(typeof(SecuredExplicitEsHandler));
        });
        return services.BuildServiceProvider();
    }

    private static IMessageContext BuildContext(params IPermission[] permissions)
    {
        var contextMock = new Mock<IMessageContext>();
        contextMock.Setup(c => c.GetFeature<UserContext<Guid>>())
            .Returns(new UserContext<Guid> { UserPermissions = permissions });
        return contextMock.Object;
    }

    private static Func<Task<Either<Exception, object>>> Next()
        => () => Task.FromResult(Either<Exception, object>.Right((object)Unit.Default));

    [Fact]
    public void SecuredExplicitEsHandler_IsDiscoveredNormally_WithANonNullMethod()
    {
        var provider = BuildProvider();
        var registry = provider.GetRequiredService<IMessageHandlerRegistry>();

        var handler = registry.GetMessageHandler(typeof(SecuredCommand)).Should().BeRight().Which;

        handler.HandlerDescription.Method.Should().NotBeNull();
        handler.HandlerDescription.Method!.Name.Should().Be(nameof(SecuredExplicitEsHandler.HandleAsync));
    }

    [Fact]
    public async Task ValidatePermissionMiddleware_UserHasBothPermissions_Allows()
    {
        var provider = BuildProvider();
        var registry = provider.GetRequiredService<IMessageHandlerRegistry>();
        var handler = registry.GetMessageHandler(typeof(SecuredCommand)).Should().BeRight().Which;
        var middleware = new ValidatePermissionMiddleware<Guid>(provider);
        var context = BuildContext(
            new Permission<CommandPermissionScope>("command.permission", new CommandPermissionScope()),
            new Permission<HandlerPermissionScope>("handler.permission", new HandlerPermissionScope())
        );

        var result = await middleware.ExecuteAsync(handler, new SecuredCommand(Guid.NewGuid()), context, Next(), CancellationToken.None);

        result.Should().BeRight();
    }

    [Fact]
    public async Task ValidatePermissionMiddleware_UserHasOnlyCommandPermission_DeniesOnTheHandlerRequirement()
    {
        var provider = BuildProvider();
        var registry = provider.GetRequiredService<IMessageHandlerRegistry>();
        var handler = registry.GetMessageHandler(typeof(SecuredCommand)).Should().BeRight().Which;
        var middleware = new ValidatePermissionMiddleware<Guid>(provider);
        var context = BuildContext(new Permission<CommandPermissionScope>("command.permission", new CommandPermissionScope()));

        var result = await middleware.ExecuteAsync(handler, new SecuredCommand(Guid.NewGuid()), context, Next(), CancellationToken.None);

        result.Should().BeLeft();
    }

    [Fact]
    public async Task ValidatePermissionMiddleware_UserHasOnlyHandlerPermission_DeniesOnTheCommandRequirement()
    {
        var provider = BuildProvider();
        var registry = provider.GetRequiredService<IMessageHandlerRegistry>();
        var handler = registry.GetMessageHandler(typeof(SecuredCommand)).Should().BeRight().Which;
        var middleware = new ValidatePermissionMiddleware<Guid>(provider);
        var context = BuildContext(new Permission<HandlerPermissionScope>("handler.permission", new HandlerPermissionScope()));

        var result = await middleware.ExecuteAsync(handler, new SecuredCommand(Guid.NewGuid()), context, Next(), CancellationToken.None);

        result.Should().BeLeft();
    }

    [Fact]
    public async Task ValidatePermissionMiddleware_UserHasNeitherPermission_Denies()
    {
        var provider = BuildProvider();
        var registry = provider.GetRequiredService<IMessageHandlerRegistry>();
        var handler = registry.GetMessageHandler(typeof(SecuredCommand)).Should().BeRight().Which;
        var middleware = new ValidatePermissionMiddleware<Guid>(provider);
        var context = BuildContext();

        var result = await middleware.ExecuteAsync(handler, new SecuredCommand(Guid.NewGuid()), context, Next(), CancellationToken.None);

        result.Should().BeLeft();
    }
}
