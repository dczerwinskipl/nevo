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

    private class CommandHandlerMock : ICommandHandler<CommandMock>
    {
        public Task<Either<Exception, Unit>> HandleAsync(CommandMock message, IMessageContext messageContext, CancellationToken cancellationToken)
        {
            throw new NotImplementedException();
        }
    }

    private record CommandMock : Command { }
}
