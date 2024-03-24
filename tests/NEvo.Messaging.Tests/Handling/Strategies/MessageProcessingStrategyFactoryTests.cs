using NEvo.Messaging.Context;
using NEvo.Messaging.Handling.Strategies;

namespace NEvo.Messaging.Tests.Handling.Strategies;


public class MessageProcessingStrategyFactoryTests
{
    private readonly Mock<IMessage> _messageMock = new();
    private readonly Mock<IMessage<int>> _messageWithResultMock = new();
    private readonly Mock<IMessageContext> _contextMock = new();
    private readonly Mock<IMessageProcessingStrategy> _applicableStrategyMock = new();
    private readonly Mock<IMessageProcessingStrategyWithResult> _applicableStrategyWithResultMock = new();

    public MessageProcessingStrategyFactoryTests()
    {
        // Setup applicable strategy mocks to always return true for ShouldApply
        _applicableStrategyMock.Setup(x => x.ShouldApply(It.IsAny<IMessage>(), It.IsAny<IMessageContext>())).Returns(true);
        _applicableStrategyWithResultMock.Setup(x => x.ShouldApply<int>(It.IsAny<IMessage<int>>(), It.IsAny<IMessageContext>())).Returns(true);
    }

    [Fact]
    public void CreateForMessage_SelectsCorrectStrategy()
    {
        // Arrange
        var strategies = new List<IMessageProcessingStrategy> { _applicableStrategyMock.Object };
        var factory = new MessageProcessingStrategyFactory(strategies, Enumerable.Empty<IMessageProcessingStrategyWithResult>());

        // Act
        var selectedStrategy = factory.CreateForMessage(_messageMock.Object, _contextMock.Object);

        // Assert
        selectedStrategy.Should().Be(_applicableStrategyMock.Object);
    }

    [Fact]
    public void CreateForMessageWithResult_SelectsCorrectStrategy()
    {
        // Arrange
        var strategiesWithResult = new List<IMessageProcessingStrategyWithResult> { _applicableStrategyWithResultMock.Object };
        var factory = new MessageProcessingStrategyFactory(Enumerable.Empty<IMessageProcessingStrategy>(), strategiesWithResult);

        // Act
        var selectedStrategy = factory.CreateForMessageWithResult<int>(_messageWithResultMock.Object, _contextMock.Object);

        // Assert
        selectedStrategy.Should().Be(_applicableStrategyWithResultMock.Object);
    }

    [Fact]
    public void CreateForMessage_ThrowsWhenNoStrategyApplies()
    {
        // Arrange
        var factory = new MessageProcessingStrategyFactory(Enumerable.Empty<IMessageProcessingStrategy>(), Enumerable.Empty<IMessageProcessingStrategyWithResult>());

        // Act
        var act = () => factory.CreateForMessage(_messageMock.Object, _contextMock.Object);

        // Assert
        act.Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public void CreateForMessageWithResult_ThrowsWhenNoStrategyApplies()
    {
        // Arrange
        var factory = new MessageProcessingStrategyFactory(Enumerable.Empty<IMessageProcessingStrategy>(), Enumerable.Empty<IMessageProcessingStrategyWithResult>());

        // Act
        var act = () => factory.CreateForMessageWithResult<int>(_messageWithResultMock.Object, _contextMock.Object);

        // Assert
        act.Should().Throw<InvalidOperationException>();
    }
}