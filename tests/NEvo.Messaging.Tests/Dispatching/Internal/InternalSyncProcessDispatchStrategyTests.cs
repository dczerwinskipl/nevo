using LanguageExt;
using NEvo.Core;
using NEvo.Messaging.Context;
using NEvo.Messaging.Dispatching.Internal;
using NEvo.Messaging.Handling;

namespace NEvo.Messaging.Tests.Dispatching.Internal;

public class InternalSyncProcessDispatchStrategyTests
{
    private readonly InternalSyncProcessDispatchStrategy _sut;
    private readonly Mock<IMessageProcessor> _messageProcessorMock;
    private readonly Mock<IMessageContext> _messageContextMock;

    public InternalSyncProcessDispatchStrategyTests()
    {
        _messageProcessorMock = new Mock<IMessageProcessor>();
        _messageContextMock = new Mock<IMessageContext>();
        _sut = new InternalSyncProcessDispatchStrategy(_messageProcessorMock.Object);
    }

    [Fact]
    public async Task DispatchAsync_ForwardsCallToMessageProcessor_WithoutResult()
    {
        // Arrange
        var messageMock = new Mock<IMessage>();
        var cancellationToken = new CancellationToken();
        var expected = UnitExt.DefaultEitherTask;
        _messageProcessorMock.Setup(mp => mp.ProcessMessageAsync(messageMock.Object, It.IsAny<IMessageContext>(), cancellationToken))
            .Returns(expected);

        // Act
        var result = await _sut.DispatchAsync(messageMock.Object, _messageContextMock.Object, cancellationToken);

        // Assert
        result.Should().BeEquivalentTo(await expected);
        _messageProcessorMock.Verify(mp => mp.ProcessMessageAsync(messageMock.Object, It.IsAny<IMessageContext>(), cancellationToken), Times.Once);
    }

    [Fact]
    public async Task DispatchAsync_ForwardsCallToMessageProcessor_WithResult()
    {
        // Arrange
        var messageMock = new Mock<IMessage<int>>();
        var cancellationToken = new CancellationToken();
        var expected = Task.FromResult(Either<Exception, int>.Right(42));
        _messageProcessorMock.Setup(mp => mp.ProcessMessageAsync(messageMock.Object, It.IsAny<IMessageContext>(), cancellationToken))
            .Returns(expected);

        // Act
        var result = await _sut.DispatchAsync(messageMock.Object, _messageContextMock.Object, cancellationToken);

        // Assert
        result.Should().BeEquivalentTo(await expected);
        _messageProcessorMock.Verify(mp => mp.ProcessMessageAsync(messageMock.Object, It.IsAny<IMessageContext>(), cancellationToken), Times.Once);
    }
}
