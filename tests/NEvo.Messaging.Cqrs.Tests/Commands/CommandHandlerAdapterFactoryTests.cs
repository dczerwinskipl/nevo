using LanguageExt;
using Microsoft.Extensions.Logging;
using NEvo.Messaging.Context;
using NEvo.Messaging.Cqrs.Commands;
using NEvo.Messaging.Handling;

namespace NEvo.Messaging.Cqrs.Tests.Commands;

public class CommandHandlerAdapterFactoryTests
{
    private readonly ILogger<MessageHandlerAdapter> _loggerMock = Mock.Of<ILogger<MessageHandlerAdapter>>();

    [Fact]
    public void ForInterface_ShouldReturnICommandHandlerGenericType()
    {
        // Arrange
        var factory = new CommandHandlerAdapterFactory(_loggerMock);

        // Act
        var forInterface = factory.ForInterface;

        // Assert
        forInterface.Should().Be(typeof(ICommandHandler<>));
    }

    [Fact]
    public void Create_ShouldReturnMessageHandlerAdapter()
    {
        // Arrange
        var factory = new CommandHandlerAdapterFactory(_loggerMock);
        var description = new MessageHandlerDescription(
            "Key",
            typeof(CommandHandlerMock),
            typeof(CommandMock),
            typeof(ICommandHandler<>),
            ReturnType: typeof(Unit),
            Method: typeof(CommandHandlerMock).GetMethod(nameof(CommandHandlerMock.HandleAsync))
        );

        // Act
        var handler = factory.Create(description);

        // Assert
        handler.Should().BeOfType<MessageHandlerAdapter>();
    }

    [Fact]
    public void GetMessageHandlerDescriptions_ShouldYieldCorrectDescription()
    {
        // Arrange
        var factory = new CommandHandlerAdapterFactory(_loggerMock);
        Type handlerType = typeof(CommandHandlerMock);
        Type handlerInterface = typeof(ICommandHandler<CommandMock>);

        // Act
        var descriptions = factory.GetMessageHandlerDescriptions(handlerType, handlerInterface).ToList();

        // Assert
        descriptions.Should().HaveCount(1);
        var description = descriptions[0];
        description.Key.Should().Be($"{handlerType.FullName}-{typeof(CommandMock).FullName}");
        description.HandlerType.Should().Be(handlerType);
        description.MessageType.Should().Be(typeof(CommandMock));
        description.InterfaceType.Should().Be(handlerInterface);
        description.ReturnType.Should().Be(typeof(Unit));
        description.Method.Should().NotBeNull();
        description.Method!.Name.Should().Be(nameof(CommandHandlerMock.HandleAsync));
    }

    [Fact]
    public async Task GetMessageHandlerDescriptions_And_Dispatch_WorkWithExplicitInterfaceImplementation()
    {
        // Arrange
        var factory = new CommandHandlerAdapterFactory(_loggerMock);
        Type handlerType = typeof(ExplicitCommandHandlerMock);
        Type handlerInterface = typeof(ICommandHandler<CommandMock>);
        var serviceProviderMock = new Mock<IServiceProvider>();
        var messageContextMock = new Mock<IMessageContext>();
        messageContextMock.SetupGet(ctx => ctx.ServiceProvider).Returns(serviceProviderMock.Object);

        // Act – factory resolution
        var descriptions = factory.GetMessageHandlerDescriptions(handlerType, handlerInterface).ToList();
        descriptions.Should().HaveCount(1);
        var adapter = factory.Create(descriptions[0]);

        // Act – dispatch
        var result = await adapter.HandleAsync(new CommandMock(), messageContextMock.Object, CancellationToken.None);

        // Assert
        result.Should().BeRight().Which.Should().Be(Unit.Default);
    }

    private class CommandHandlerMock : ICommandHandler<CommandMock>
    {
        public Task<Either<Exception, Unit>> HandleAsync(CommandMock message, IMessageContext messageContext, CancellationToken cancellationToken)
        {
            throw new NotImplementedException();
        }
    }

    private class ExplicitCommandHandlerMock : ICommandHandler<CommandMock>
    {
        Task<Either<Exception, Unit>> ICommandHandler<CommandMock>.HandleAsync(CommandMock message, IMessageContext messageContext, CancellationToken cancellationToken)
            => Task.FromResult(Either<Exception, Unit>.Right(Unit.Default));
    }

    private record CommandMock : Command { }
}
