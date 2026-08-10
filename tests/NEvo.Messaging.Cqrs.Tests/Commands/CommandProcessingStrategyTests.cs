using LanguageExt;
using NEvo.Core;
using NEvo.Messaging.Context;
using NEvo.Messaging.Cqrs.Commands;
using NEvo.Messaging.Events;
using NEvo.Messaging.Handling;
using NEvo.Messaging.Handling.Exceptions;

namespace NEvo.Messaging.Cqrs.Tests.Commands;

public class CommandProcessingStrategyTests
{
    private readonly Mock<IMessageHandlerRegistry> _messageHandlerRegistryMock;
    private readonly Mock<IMiddlewareHandler<(IMessageHandler MessageHandler, IMessage Message, IMessageContext Context), Either<Exception, object>>> _middlewareMock;
    private readonly Mock<IMessageContext> _messageContextMock;
    private readonly CommandProcessingStrategy _strategy;

    public CommandProcessingStrategyTests()
    {
        _messageHandlerRegistryMock = new Mock<IMessageHandlerRegistry>();
        _middlewareMock = new Mock<IMiddlewareHandler<(IMessageHandler MessageHandler, IMessage Message, IMessageContext Context), Either<Exception, object>>>();
        _messageContextMock = new Mock<IMessageContext>();

        _middlewareMock
            .Setup(m => m.ExecuteAsync(
                It.IsAny<Func<(IMessageHandler MessageHandler, IMessage Message, IMessageContext Context), CancellationToken, Task<Either<Exception, object>>>>(),
                It.IsAny<(IMessageHandler MessageHandler, IMessage Message, IMessageContext Context)>(),
                It.IsAny<CancellationToken>()))
            .Returns((
                Func<(IMessageHandler MessageHandler, IMessage Message, IMessageContext Context), CancellationToken, Task<Either<Exception, object>>> baseDelegate,
                (IMessageHandler MessageHandler, IMessage Message, IMessageContext Context) input,
                CancellationToken cancellationToken) => baseDelegate(input, cancellationToken));

        _strategy = new CommandProcessingStrategy(_messageHandlerRegistryMock.Object, _middlewareMock.Object);
    }

    [Fact]
    public void ShouldApply_ReturnsTrue_ForCommandInstances()
    {
        // Arrange
        var command = new Command();

        // Act
        var result = _strategy.ShouldApply(command, _messageContextMock.Object);

        // Assert
        result.Should().BeTrue();
    }

    [Fact]
    public void ShouldApply_ReturnsFalse_ForNonCommandInstances()
    {
        // Arrange
        var @event = new Event();

        // Act
        var result = _strategy.ShouldApply(@event, _messageContextMock.Object);

        // Assert
        result.Should().BeFalse();
    }

    [Fact]
    public async Task ProcessMessageAsync_ResolvesHandlerFromRegistry_AndReturnsUnit_OnSuccess()
    {
        // Arrange
        var command = new Command();
        var cancellationToken = new CancellationToken();
        var handlerMock = new Mock<IMessageHandler>();
        handlerMock
            .Setup(h => h.HandleAsync(command, _messageContextMock.Object, cancellationToken))
            .Returns(Task.FromResult(Either<Exception, object>.Right(Unit.Default)));
        _messageHandlerRegistryMock
            .Setup(r => r.GetMessageHandler(command))
            .Returns(Either<Exception, IMessageHandler>.Right(handlerMock.Object));

        // Act
        var result = await _strategy.ProcessMessageAsync(command, _messageContextMock.Object, cancellationToken);

        // Assert
        result.Should().BeRight().Which.Should().Be(Unit.Default);
        handlerMock.Verify(h => h.HandleAsync(command, _messageContextMock.Object, cancellationToken), Times.Once);
    }

    [Fact]
    public async Task ProcessMessageAsync_ReturnsLeft_WhenNoHandlerFound()
    {
        // Arrange
        var command = new Command();
        var cancellationToken = new CancellationToken();
        var exception = new NoHandlerFoundException(typeof(Command));
        _messageHandlerRegistryMock
            .Setup(r => r.GetMessageHandler(command))
            .Returns(Either<Exception, IMessageHandler>.Left(exception));

        // Act
        var result = await _strategy.ProcessMessageAsync(command, _messageContextMock.Object, cancellationToken);

        // Assert
        result.Should().BeLeft().Which.Should().Be(exception);
    }

    [Fact]
    public async Task ProcessMessageAsync_ReturnsLeft_WhenMoreThanOneHandlerFound()
    {
        // Arrange
        var command = new Command();
        var cancellationToken = new CancellationToken();
        var exception = new MoreThanOneHandlerFoundException(typeof(Command), []);
        _messageHandlerRegistryMock
            .Setup(r => r.GetMessageHandler(command))
            .Returns(Either<Exception, IMessageHandler>.Left(exception));

        // Act
        var result = await _strategy.ProcessMessageAsync(command, _messageContextMock.Object, cancellationToken);

        // Assert
        result.Should().BeLeft().Which.Should().Be(exception);
    }
}
