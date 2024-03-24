using LanguageExt;
using Microsoft.VisualStudio.TestPlatform.CommunicationUtilities;
using Microsoft.VisualStudio.TestPlatform.CommunicationUtilities.ObjectModel;
using NEvo.Messaging.Context;
using NEvo.Messaging.Transporting;

namespace NEvo.Messaging.Tests.Transporting;

public class MessageEnvelopeMapperTests
{
    private readonly Mock<IMessageSerializer> _messageSerializerMock = new();
    private readonly MessageEnvelopeMapper _mapper;

    public MessageEnvelopeMapperTests()
    {
        _mapper = new MessageEnvelopeMapper(_messageSerializerMock.Object);
    }

    [Fact]
    public void ToMessageEnvelope_SuccessfullyDeserializes()
    {
        // Arrange
        var dto = new MessageEnvelopeDto(Guid.NewGuid(), typeof(MyMessage).AssemblyQualifiedName!, "{}", "{}");
        var expectedMessage = new MyMessage();
        _messageSerializerMock.Setup(s => s.DeserializeMessage(dto.Payload, dto.MessageType))
            .Returns(Either<Exception, IMessage>.Right(expectedMessage));
        _messageSerializerMock.Setup(s => s.DeserializeHeaders(dto.Headers))
            .Returns(Either<Exception, IMessageContextHeaders>.Right(new MessageContextHeaders(new Dictionary<string,string>())));

        // Act
        var result = _mapper.ToMessageEnvelope(dto);

        // Assert
        var envelope = result.ExpectRight();
        envelope.Message.Should().Be(expectedMessage);
        envelope.Headers.Should().NotBeNull();
    }

    [Fact]
    public void ToMessageEnvelope_HandlesDeserializationFailure()
    {
        // Arrange
        var dto = new MessageEnvelopeDto(Guid.NewGuid(), typeof(MyMessage).AssemblyQualifiedName!, "{}", "{}");
        _messageSerializerMock.Setup(s => s.DeserializeMessage(dto.Payload, dto.MessageType))
            .Returns(Either<Exception, IMessage>.Left(new Exception()));

        // Act
        var result = _mapper.ToMessageEnvelope(dto);

        // Assert
        result.ExpectLeft();
    }

    [Fact]
    public void ToMessageEnvelopeDTO_SuccessfullySerializes()
    {
        // Arrange
        var message = new MyMessage();
        var headers = new MessageContextHeaders(new Dictionary<string, string>());
        var envelope = new MessageEnvelope(message, headers);
        var serializationResult = (Payload: "{}", MessageType: "MyMessage");
        _messageSerializerMock.Setup(s => s.Serialize(message))
            .Returns(Either<Exception, (string Payload, string MessageType)>.Right(serializationResult));
        _messageSerializerMock.Setup(s => s.SerializeHeaders(headers))
            .Returns(Either<Exception, string>.Right("{}"));

        // Act
        var result = _mapper.ToMessageEnvelopeDTO(envelope);

        // Assert
        var dto = result.ExpectRight();
        dto.MessageType.Should().Be(serializationResult.MessageType);
        dto.Payload.Should().Be(serializationResult.Payload);
        dto.Headers.Should().Be("{}");
    }

    [Fact]
    public void ToMessageEnvelopeDTO_HandlesSerializationFailure()
    {
        // Arrange
        var message = new MyMessage();
        var headers = new MessageContextHeaders(new Dictionary<string, string>());
        var envelope = new MessageEnvelope(message, headers);
        _messageSerializerMock.Setup(s => s.Serialize(message))
            .Returns(Either<Exception, (string Payload, string MessageType)>.Left(new Exception("Serialization failed")));

        // Act
        var result = _mapper.ToMessageEnvelopeDTO(envelope);

        // Assert
        result.IsLeft.Should().BeTrue();
    }

    private record MyMessage : Message
    {
        
    }
}

