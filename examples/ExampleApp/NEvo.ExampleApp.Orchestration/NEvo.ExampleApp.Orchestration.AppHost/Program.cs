var builder = DistributedApplication.CreateBuilder(args);

var serviceB = builder.AddProject<Projects.NEvo_ExampleApp_ServiceB_Api>("ServiceB");

builder.AddProject<Projects.NEvo_ExampleApp_ServiceA_Api>("ServiceA")
    .WithReference(serviceB);


builder.Build().Run();
