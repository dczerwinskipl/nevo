using LanguageExt;
using NEvo.Messaging.Context;
using NEvo.Messaging.Cqrs.Commands;
using NEvo.Messaging.Dispatching;

namespace NEvo.Messaging.Cqrs.Tests.Commands;

public class CommandDispatcherTests
{
    private readonly Mock<IMessageDispatchStrategyFactory<Command>> _strategyFactoryMock;
    private readonly Mock<IMessageDispatchStrategy> _strategyMock;
    private readonly Mock<IMessageContextAccessor> _messageContextAccessorMock;
    private readonly Mock<IMessageContextProvider> _messageContextProviderMock;
    private readonly CommandDispatcher _dispatcher;

    public CommandDispatcherTests()
    {
        _strategyFactoryMock = new Mock<IMessageDispatchStrategyFactory<Command>>();
        _strategyMock = new Mock<IMessageDispatchStrategy>();
        _messageContextAccessorMock = new Mock<IMessageContextAccessor>();
        _messageContextProviderMock = new Mock<IMessageContextProvider>();

        _strategyFactoryMock.Setup(f => f.CreateFor(It.IsAny<Command>())).Returns(_strategyMock.Object);

        _dispatcher = new CommandDispatcher(
            _strategyFactoryMock.Object,
            _messageContextAccessorMock.Object,
            _messageContextProviderMock.Object
        );
    }

    [Fact]
    public async Task DispatchAsync_CreatesContext_WhenNoneIsSetOnAccessor()
    {
        // Arrange
        var command = new Command();
        var cancellationToken = new CancellationToken();
        var createdContext = new Mock<IMessageContext>().Object;
        _messageContextAccessorMock.SetupProperty(a => a.MessageContext, null);
        _messageContextProviderMock.Setup(p => p.CreateContext()).Returns(createdContext);
        _strategyMock
            .Setup(s => s.DispatchAsync(command, createdContext, cancellationToken))
            .Returns(Task.FromResult(Either<Exception, Unit>.Right(Unit.Default)));

        // Act
        var result = await _dispatcher.DispatchAsync(command, cancellationToken);

        // Assert
        result.Should().BeRight().Which.Should().Be(Unit.Default);
        _messageContextProviderMock.Verify(p => p.CreateContext(), Times.Once);
        _messageContextAccessorMock.Object.MessageContext.Should().Be(createdContext);
        _strategyMock.Verify(s => s.DispatchAsync(command, createdContext, cancellationToken), Times.Once);
    }

    [Fact]
    public async Task DispatchAsync_ReusesExistingContext_WhenAlreadySetOnAccessor()
    {
        // Arrange
        var command = new Command();
        var cancellationToken = new CancellationToken();
        var existingContext = new Mock<IMessageContext>().Object;
        _messageContextAccessorMock.SetupProperty(a => a.MessageContext, existingContext);
        _strategyMock
            .Setup(s => s.DispatchAsync(command, existingContext, cancellationToken))
            .Returns(Task.FromResult(Either<Exception, Unit>.Right(Unit.Default)));

        // Act
        var result = await _dispatcher.DispatchAsync(command, cancellationToken);

        // Assert
        result.Should().BeRight().Which.Should().Be(Unit.Default);
        _messageContextProviderMock.Verify(p => p.CreateContext(), Times.Never);
        _strategyMock.Verify(s => s.DispatchAsync(command, existingContext, cancellationToken), Times.Once);
    }
}
